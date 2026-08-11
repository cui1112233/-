const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { PRIMARY_USER } = require('../shared');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');
const {
  assertValidProjectId,
  assertValidUsername,
  cloneJsonSafe,
  isPlainObject,
  isValidProjectId,
  normalizeProject
} = require('./contracts');

const MIGRATION_VERSION = 1;
const LEGACY_COLLECTION_KEYS = ['projects', 'history', 'items', 'records'];
const V77_DATA_KEYS = new Set([
  'novel_text', 'novelText', 'outline_shots', 'timeline_segments', 'characters',
  'relationships', 'ai_instructions', 'instructions', 'panel_settings', 'settings',
  'final_segments', 'outputs', 'scenes'
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MIGRATION_MARKER_FIELDS = new Set(['version', 'source_fingerprint', 'imported_sources', 'updated_at']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readProjectFile(filePath, expectedId) {
  let result;
  try {
    result = readJsonOrMissing(filePath);
  } catch {
    throw new Error('Invalid project store');
  }
  if (!result.found) return null;
  try {
    const project = normalizeProject(result.value);
    if (project.id !== expectedId) throw new Error('Project id mismatch');
    return project;
  } catch {
    throw new Error('Invalid project store');
  }
}

function parseLegacyJsonFiles(legacyDir) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(legacyDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];

  const files = [];
  function walk(currentPath, relativePath, depth) {
    if (depth > 5) return;
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(currentPath, entry.name);
      const entryRelative = path.join(relativePath, entry.name);
      if (entry.isDirectory()) walk(entryPath, entryRelative, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push({ path: entryPath, relative: entryRelative });
    }
  }
  walk(legacyDir, '', 0);
  return files;
}

function isV77ProjectLike(value) {
  if (!isPlainObject(value)) return false;
  const data = isPlainObject(value.data) ? value.data : isPlainObject(value.project_data) ? value.project_data : value;
  const hasV77Data = Object.keys(data).some(key => V77_DATA_KEYS.has(key));
  const hasIdentity = typeof value.id === 'string' || typeof value.project_id === 'string'
    || typeof value.name === 'string' || typeof value.project_name === 'string';
  return hasV77Data && (hasIdentity || data !== value);
}

function extractLegacyProjects(value) {
  if (Array.isArray(value)) return value.flatMap(extractLegacyProjects);
  if (!isPlainObject(value)) return [];

  const direct = isPlainObject(value.project)
    ? { ...value, ...value.project }
    : isPlainObject(value.project_data)
      ? { ...value, data: value.project_data }
      : value;
  if (isV77ProjectLike(direct)) return [direct];

  const found = [];
  for (const key of LEGACY_COLLECTION_KEYS) {
    if (Array.isArray(value[key])) found.push(...value[key].flatMap(extractLegacyProjects));
  }
  return found;
}

function legacyFallbackId(relativePath, value) {
  const basename = path.basename(relativePath, path.extname(relativePath));
  if (isValidProjectId(basename)) return basename;
  return `legacy_${sha256(`${relativePath}\n${stableJson(value)}`).slice(0, 64)}`;
}

function normalizeLegacyProject(value, relativePath) {
  const source = cloneJsonSafe(value);
  const fallbackId = legacyFallbackId(relativePath, source);
  const withData = isPlainObject(source.data)
    ? source
    : isPlainObject(source.project_data)
      ? { ...source, data: source.project_data }
      : source;
  return normalizeProject(withData, { fallbackId });
}

function readMigrationMarker(markerPath) {
  let result;
  try {
    result = readJsonOrMissing(markerPath);
  } catch {
    throw new Error('Invalid novel-panel migration marker');
  }
  if (!result.found) {
    return { version: MIGRATION_VERSION, source_fingerprint: null, imported_sources: {} };
  }
  const marker = result.value;
  if (!isPlainObject(marker) || marker.version !== MIGRATION_VERSION
    || typeof marker.source_fingerprint !== 'string' || !SHA256_PATTERN.test(marker.source_fingerprint)
    || !isPlainObject(marker.imported_sources)
    || typeof marker.updated_at !== 'string' || !ISO_TIME_PATTERN.test(marker.updated_at)
    || Number.isNaN(Date.parse(marker.updated_at))
    || Object.keys(marker).some(key => !MIGRATION_MARKER_FIELDS.has(key))) {
    throw new Error('Invalid novel-panel migration marker');
  }
  for (const [fingerprint, id] of Object.entries(marker.imported_sources)) {
    if (!SHA256_PATTERN.test(fingerprint) || !isValidProjectId(id)) {
      throw new Error('Invalid novel-panel migration marker');
    }
  }
  return marker;
}

function createNovelPanelStore({ usersDir, legacyDir } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);
  const configuredLegacyDir = legacyDir === undefined ? process.env.QIANTIE_NOVEL_PANEL_LEGACY_DIR : legacyDir;
  const resolvedLegacyDir = typeof configuredLegacyDir === 'string' && configuredLegacyDir.trim()
    ? path.resolve(configuredLegacyDir)
    : null;

  function panelDir(username) {
    const user = assertValidUsername(username);
    return path.join(resolvedUsersDir, user, 'novel-panel');
  }

  function projectsDir(username) {
    return path.join(panelDir(username), 'projects');
  }

  function projectPath(username, id) {
    assertValidUsername(username);
    assertValidProjectId(id);
    return path.join(projectsDir(username), `${id}.json`);
  }

  function settingsPath(username) {
    return path.join(panelDir(username), 'settings.json');
  }

  function outputsDir(username) {
    return path.join(panelDir(username), 'outputs');
  }

  function migrationPath(username) {
    return path.join(panelDir(username), 'migration.json');
  }

  function saveProject(username, project) {
    assertValidUsername(username);
    const normalized = normalizeProject(project);
    writeJsonAtomic(projectPath(username, normalized.id), normalized);
    return cloneJsonSafe(normalized);
  }

  function loadProject(username, id) {
    assertValidUsername(username);
    assertValidProjectId(id);
    const project = readProjectFile(projectPath(username, id), id);
    return project === null ? null : cloneJsonSafe(project);
  }

  function listProjects(username) {
    assertValidUsername(username);
    const directory = projectsDir(username);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const projects = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      if (!isValidProjectId(id)) continue;
      const project = readProjectFile(projectPath(username, id), id);
      projects.push({
        id: project.id,
        name: project.name,
        created_at: project.created_at,
        updated_at: project.updated_at
      });
    }
    return projects.sort((left, right) => {
      const timeDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
      return left.id.localeCompare(right.id);
    });
  }

  function deleteProject(username, id) {
    assertValidUsername(username);
    assertValidProjectId(id);
    try {
      fs.unlinkSync(projectPath(username, id));
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function migrateLegacyIfNeeded(username) {
    const user = assertValidUsername(username);
    if (user !== PRIMARY_USER || !resolvedLegacyDir) return { imported: 0, sourceFingerprint: null };

    const lockPath = path.join(panelDir(user), 'migration.lock');
    return withJsonLock(lockPath, () => {
      const markerFile = migrationPath(user);
      const marker = readMigrationMarker(markerFile);
      const legacyFiles = parseLegacyJsonFiles(resolvedLegacyDir);
      const sourceFingerprint = sha256(legacyFiles.map(file => {
        const content = fs.readFileSync(file.path, 'utf8');
        return `${file.relative}\n${sha256(content)}`;
      }).join('\n'));
      const candidates = [];
      for (const file of legacyFiles) {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        } catch {
          continue;
        }
        for (const rawProject of extractLegacyProjects(parsed)) {
          try {
            const project = normalizeLegacyProject(rawProject, file.relative);
            const fingerprint = sha256(stableJson(project));
            candidates.push({ fingerprint, project });
          } catch {
            // A malformed legacy record cannot block a safe import of other records.
          }
        }
      }

      const importedSources = { ...marker.imported_sources };
      const seen = new Set(Object.keys(importedSources));
      let imported = 0;
      for (const candidate of candidates) {
        if (seen.has(candidate.fingerprint)) continue;
        let id = candidate.project.id;
        const existing = loadProject(user, id);
        if (existing) id = `legacy_${candidate.fingerprint.slice(0, 64)}`;
        if (!isValidProjectId(id)) throw new Error('Invalid imported project id');
        const importedProject = id === candidate.project.id ? candidate.project : { ...candidate.project, id };
        saveProject(user, importedProject);
        importedSources[candidate.fingerprint] = id;
        seen.add(candidate.fingerprint);
        imported += 1;
      }

      if (imported > 0 || marker.source_fingerprint !== sourceFingerprint) {
        writeJsonAtomic(markerFile, {
          version: MIGRATION_VERSION,
          source_fingerprint: sourceFingerprint,
          imported_sources: importedSources,
          updated_at: new Date().toISOString()
        });
      }
      return { imported, sourceFingerprint };
    });
  }

  return {
    deleteProject,
    listProjects,
    loadProject,
    migrateLegacyIfNeeded,
    outputsDir,
    panelDir,
    projectPath,
    projectsDir,
    saveProject,
    settingsPath
  };
}

module.exports = { createNovelPanelStore };
