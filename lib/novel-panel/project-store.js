const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { PRIMARY_USER } = require('../shared');
const {
  readJsonOrMissing,
  writeJsonAtomic,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
} = require('../system-store');
const {
  assertValidProjectId,
  assertValidUsername,
  cloneJsonSafe,
  isPlainObject,
  isValidProjectId,
  isValidUsername,
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

function invalidLegacySource(relativePath, detail = '') {
  return new Error(`Invalid legacy project source: ${relativePath}${detail ? ` (${detail})` : ''}`);
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

function legacyJsonKind(relativePath) {
  const parts = relativePath.split(path.sep);
  const filename = parts.at(-1).toLowerCase();
  if (parts.includes('projects') || filename === 'history.json' || filename === 'projects.json') return 'projects';
  if (filename === 'settings.json') return 'settings';
  return 'unsupported';
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
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push({ path: entryPath, relative: entryRelative, kind: legacyJsonKind(entryRelative) });
      }
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

function projectEnvelope(value) {
  if (!isPlainObject(value)) return null;
  if (isPlainObject(value.project)) {
    const merged = { ...value, ...value.project };
    if (isV77ProjectLike(merged)) return value;
  }
  if (isPlainObject(value.project_data) && isV77ProjectLike({ ...value, data: value.project_data })) return value;
  return isV77ProjectLike(value) ? value : null;
}

function extractLegacyProjects(value) {
  if (Array.isArray(value)) return value.flatMap(extractLegacyProjects);
  const direct = projectEnvelope(value);
  if (direct) return [direct];
  if (!isPlainObject(value)) throw new Error('unsupported record type');

  const collections = LEGACY_COLLECTION_KEYS.filter(key => Object.hasOwn(value, key));
  if (!collections.length) throw new Error('unsupported record');
  const found = [];
  for (const key of collections) {
    if (!Array.isArray(value[key])) throw new Error(`unsupported ${key} collection`);
    found.push(...value[key].flatMap(extractLegacyProjects));
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
  const envelope = isPlainObject(source.project)
    ? { ...source, ...source.project }
    : isPlainObject(source.project_data)
      ? { ...source, data: source.project_data }
      : source;
  return normalizeProject(envelope, { fallbackId: legacyFallbackId(relativePath, source) });
}

function validateMigrationMarker(marker) {
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
  return validateMigrationMarker(result.value);
}

function createNovelPanelStore({ usersDir, legacyDir, transactionWriter = writeJsonTransaction } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  if (typeof transactionWriter !== 'function') throw new Error('transactionWriter must be a function');
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

  function mutationLockPath(username) {
    return path.join(panelDir(username), 'mutation.lock');
  }

  function migrationTransactionPath(username) {
    return path.join(panelDir(username), 'migration-transaction.json');
  }

  function isProjectWritePath(username, filePath) {
    const resolved = path.resolve(filePath);
    const directory = path.resolve(projectsDir(username));
    if (path.dirname(resolved) !== directory) return false;
    const id = path.basename(resolved, '.json');
    return path.extname(resolved) === '.json' && isValidProjectId(id) && resolved === path.resolve(projectPath(username, id));
  }

  function allowedTransactionPaths(username) {
    const journalPath = migrationTransactionPath(username);
    let journal;
    try {
      const result = readJsonOrMissing(journalPath);
      if (!result.found) return null;
      journal = result.value;
    } catch {
      throw new Error('Invalid novel-panel migration transaction');
    }
    if (!isPlainObject(journal) || !Array.isArray(journal.writes) || !journal.writes.length) {
      throw new Error('Invalid novel-panel migration transaction');
    }
    const markerFile = path.resolve(migrationPath(username));
    const allowed = [];
    let markerCount = 0;
    for (const write of journal.writes) {
      if (!isPlainObject(write) || typeof write.filePath !== 'string') {
        throw new Error('Invalid novel-panel migration transaction');
      }
      const filePath = path.resolve(write.filePath);
      if (filePath === markerFile) markerCount += 1;
      else if (!isProjectWritePath(username, filePath)) throw new Error('Invalid novel-panel migration transaction');
      allowed.push(filePath);
    }
    if (markerCount !== 1) throw new Error('Invalid novel-panel migration transaction');
    return allowed;
  }

  function validateMigrationJournal(username, journal) {
    let markerCount = 0;
    for (const write of journal.writes) {
      const filePath = path.resolve(write.filePath);
      if (filePath === path.resolve(migrationPath(username))) {
        validateMigrationMarker(write.value);
        markerCount += 1;
      } else {
        const id = path.basename(filePath, '.json');
        const project = normalizeProject(write.value);
        if (project.id !== id) throw new Error('Invalid novel-panel migration transaction');
      }
    }
    if (markerCount !== 1) throw new Error('Invalid novel-panel migration transaction');
  }

  function recoverPendingTransactionUnlocked(username) {
    const allowedPaths = allowedTransactionPaths(username);
    if (!allowedPaths) return false;
    try {
      return recoverJsonTransaction(migrationTransactionPath(username), {
        allowedPaths,
        validateJournal: journal => validateMigrationJournal(username, journal)
      });
    } catch (error) {
      if (error && /^Invalid novel-panel migration transaction/.test(error.message)) throw error;
      throw new Error('Invalid novel-panel migration transaction');
    }
  }

  function withUserMutationLock(username, operation) {
    const user = assertValidUsername(username);
    return withJsonLock(mutationLockPath(user), () => {
      recoverPendingTransactionUnlocked(user);
      return operation(user);
    });
  }

  function recoverTransactionsAtStartup() {
    let entries;
    try {
      entries = fs.readdirSync(resolvedUsersDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidUsername(entry.name)) continue;
      withUserMutationLock(entry.name, () => undefined);
    }
  }

  function saveProjectUnlocked(username, project) {
    const normalized = normalizeProject(project);
    writeJsonAtomic(projectPath(username, normalized.id), normalized);
    return cloneJsonSafe(normalized);
  }

  function loadProjectUnlocked(username, id) {
    return readProjectFile(projectPath(username, id), id);
  }

  function saveProject(username, project) {
    const user = assertValidUsername(username);
    return withUserMutationLock(user, lockedUser => saveProjectUnlocked(lockedUser, project));
  }

  function loadProject(username, id) {
    const user = assertValidUsername(username);
    assertValidProjectId(id);
    const project = loadProjectUnlocked(user, id);
    return project === null ? null : cloneJsonSafe(project);
  }

  function listProjects(username) {
    const user = assertValidUsername(username);
    const directory = projectsDir(user);
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
      const project = loadProjectUnlocked(user, id);
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
    const user = assertValidUsername(username);
    return withUserMutationLock(user, lockedUser => {
      assertValidProjectId(id);
      try {
        fs.unlinkSync(projectPath(lockedUser, id));
        return true;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  function prevalidateLegacySources() {
    let legacyFiles;
    try {
      legacyFiles = parseLegacyJsonFiles(resolvedLegacyDir);
    } catch (error) {
      throw invalidLegacySource('.', error.message);
    }
    const candidates = [];
    for (const file of legacyFiles) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file.path, 'utf8'));
      } catch (error) {
        throw invalidLegacySource(file.relative, error.message);
      }
      if (file.kind === 'settings') {
        if (!isPlainObject(parsed)) throw invalidLegacySource(file.relative, 'unsupported settings record');
        continue;
      }
      if (file.kind !== 'projects') throw invalidLegacySource(file.relative, 'unsupported JSON file');
      let records;
      try {
        records = extractLegacyProjects(parsed);
      } catch (error) {
        throw invalidLegacySource(file.relative, error.message);
      }
      for (const rawRecord of records) {
        try {
          const sourceRecord = cloneJsonSafe(rawRecord);
          const sourceKey = sha256(`${file.relative}\n${stableJson(sourceRecord)}`);
          const contentIdentity = sha256(stableJson(sourceRecord));
          candidates.push({ sourceKey, contentIdentity, project: normalizeLegacyProject(sourceRecord, file.relative) });
        } catch (error) {
          throw invalidLegacySource(file.relative, error.message);
        }
      }
    }
    const sourceFingerprint = sha256(legacyFiles.map(file => `${file.relative}\n${sha256(fs.readFileSync(file.path, 'utf8'))}`).join('\n'));
    return { candidates, sourceFingerprint };
  }

  function migrateLegacyIfNeeded(username) {
    const user = assertValidUsername(username);
    if (user !== PRIMARY_USER || !resolvedLegacyDir) return { imported: 0, sourceFingerprint: null };

    return withUserMutationLock(user, lockedUser => {
      const markerFile = migrationPath(lockedUser);
      const marker = readMigrationMarker(markerFile);
      const { candidates, sourceFingerprint } = prevalidateLegacySources();
      const importedSources = { ...marker.imported_sources };
      const seen = new Set(Object.keys(importedSources));
      const importedIdsByContent = new Map();
      const reservedIds = new Set();
      const writes = [];
      let imported = 0;

      for (const candidate of candidates) {
        if (!seen.has(candidate.sourceKey)) continue;
        const mappedId = importedSources[candidate.sourceKey];
        const knownId = importedIdsByContent.get(candidate.contentIdentity);
        if (knownId && knownId !== mappedId) throw new Error('Legacy project identity conflict');
        importedIdsByContent.set(candidate.contentIdentity, mappedId);
      }

      for (const candidate of candidates) {
        if (seen.has(candidate.sourceKey)) continue;
        const mirroredId = importedIdsByContent.get(candidate.contentIdentity);
        if (mirroredId) {
          importedSources[candidate.sourceKey] = mirroredId;
          seen.add(candidate.sourceKey);
          continue;
        }
        let id = candidate.project.id;
        const existing = reservedIds.has(id) || loadProjectUnlocked(lockedUser, id);
        if (existing) id = `legacy_${candidate.sourceKey}`;
        if (!isValidProjectId(id) || reservedIds.has(id) || loadProjectUnlocked(lockedUser, id)) {
          throw new Error('Legacy project id conflict');
        }
        const importedProject = id === candidate.project.id ? candidate.project : { ...candidate.project, id };
        writes.push({ filePath: projectPath(lockedUser, id), value: importedProject });
        importedSources[candidate.sourceKey] = id;
        importedIdsByContent.set(candidate.contentIdentity, id);
        reservedIds.add(id);
        seen.add(candidate.sourceKey);
        imported += 1;
      }

      if (imported > 0 || marker.source_fingerprint !== sourceFingerprint) {
        const nextMarker = {
          version: MIGRATION_VERSION,
          source_fingerprint: sourceFingerprint,
          imported_sources: importedSources,
          updated_at: new Date().toISOString()
        };
        writes.push({ filePath: markerFile, value: nextMarker });
        transactionWriter(migrationTransactionPath(lockedUser), writes, {
          allowedPaths: writes.map(write => write.filePath),
          validateJournal: journal => validateMigrationJournal(lockedUser, journal)
        });
      }
      return { imported, sourceFingerprint };
    });
  }

  recoverTransactionsAtStartup();

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
