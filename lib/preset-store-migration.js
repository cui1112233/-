const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  readJsonOrMissing,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
} = require('./system-store');
const {
  clone,
  isPlainObject,
  isPresetIdentifier,
  isModuleIdentifier,
  isUsername,
  isTime,
  isJsonValue,
  isCompatibleBaseIds,
  validatePreset,
  validatePresets,
  validateAudit
} = require('./preset-store-schema');

const CURRENT_SCHEMA_VERSION = 2;
const QUARANTINE_SCHEMA_VERSION = 1;
const MIGRATION_AUDIT_SCHEMA_VERSION = 1;
const FALLBACK_ACTOR = 'legacy_migration';
const LEGACY_AUDIT_ACTIONS = Object.freeze({
  created: 'preset.draft_created',
  draft_created: 'preset.draft_created',
  'preset.created': 'preset.draft_created',
  published: 'preset.published',
  publish: 'preset.published',
  rolled_back: 'preset.rolled_back',
  rollback: 'preset.rolled_back'
});

function migrationError(message, cause) {
  const error = new Error(`Preset store migration failed: ${message}`);
  if (cause) error.cause = cause;
  return error;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Buffer(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function combinedSourceDigest(presetsRaw, auditRaw) {
  return sha256Buffer(Buffer.concat([
    Buffer.from('presets\0', 'utf8'),
    presetsRaw || Buffer.from('<missing>', 'utf8'),
    Buffer.from('\0preset-audit\0', 'utf8'),
    auditRaw || Buffer.from('<missing>', 'utf8')
  ]));
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems that do not expose POSIX mode bits.
  }
}

function safeRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function readRawFile(filePath) {
  try {
    return { found: true, raw: fs.readFileSync(filePath) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { found: false, raw: null };
    throw error;
  }
}

function parseArray(rawState, label) {
  if (!rawState.found) return [];
  let value;
  try {
    value = JSON.parse(rawState.raw.toString('utf8'));
  } catch (error) {
    throw migrationError(`${label} is not valid JSON; original file was not replaced`, error);
  }
  if (!Array.isArray(value)) {
    throw migrationError(`${label} must contain a JSON array; original file was not replaced`);
  }
  return value;
}

function readOwnedObject(filePath, fallback, label) {
  const result = readJsonOrMissing(filePath);
  if (!result.found) return clone(fallback);
  if (!isPlainObject(result.value)) throw migrationError(`${label} is invalid`);
  return result.value;
}

function fixedNowISO(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid migration clock');
  return date.toISOString();
}

function backupName(timestamp, digest, suffix) {
  const safeTime = timestamp.replace(/[:.]/g, '-');
  const shortDigest = digest.replace(/^sha256:/, '').slice(0, 12);
  return `${safeTime}-${shortDigest}-${suffix}`;
}

function writeExclusiveBackup(backupDir, timestamp, suffix, raw) {
  if (!raw) return null;
  const digest = sha256Buffer(raw);
  ensurePrivateDirectory(backupDir);
  const target = path.join(backupDir, backupName(timestamp, digest, suffix));
  let descriptor;
  try {
    descriptor = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(descriptor, raw);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
    return target;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (error && error.code === 'EEXIST') {
      const existing = fs.readFileSync(target);
      if (sha256Buffer(existing) === digest) return target;
    }
    throw error;
  }
}

function own(value, key) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function pickField(record, canonical, aliases, changes) {
  if (own(record, canonical)) return record[canonical];
  for (const alias of aliases) {
    if (own(record, alias)) {
      changes.push(`mapped ${alias} -> ${canonical}`);
      return record[alias];
    }
  }
  return undefined;
}

function textOr(value, fallback, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizePresetRecord(record, sourceIndex, timestamp) {
  if (!isPlainObject(record)) {
    return { error: 'preset record is not an object' };
  }
  const changes = [];
  const id = pickField(record, 'id', ['presetId', 'key'], changes);
  if (!isPresetIdentifier(id)) return { error: 'missing or invalid preset id' };

  const module = pickField(record, 'module', ['moduleId'], changes);
  if (!isModuleIdentifier(module)) return { error: 'missing or invalid preset module' };

  const body = pickField(record, 'body', ['content', 'prompt'], changes);
  if (body === undefined || !isJsonValue(body)) return { error: 'missing or invalid preset body' };

  const compatibleRaw = pickField(record, 'compatibleBaseIds', ['compatibleBases'], changes);
  const compatibleBaseIds = compatibleRaw === undefined ? [] : compatibleRaw;
  if (!isCompatibleBaseIds(compatibleBaseIds)) return { error: 'invalid compatible base ids' };
  if (compatibleRaw === undefined) changes.push('added compatibleBaseIds=[]');

  const protocolLock = own(record, 'protocolLock') ? record.protocolLock : null;
  if (!isJsonValue(protocolLock)) return { error: 'invalid protocolLock' };
  if (!own(record, 'protocolLock')) changes.push('added protocolLock=null');

  const kindRaw = pickField(record, 'kind', ['type'], changes);
  let kind = kindRaw;
  if (kind === undefined || kind === null || kind === '') {
    kind = protocolLock?.format === 'constraint' ? 'addon' : 'base';
    changes.push(`added kind=${kind}`);
  }
  if (kind !== 'base' && kind !== 'addon') return { error: 'invalid preset kind' };
  if (kind === 'base' && compatibleBaseIds.length > 0) return { error: 'base preset cannot declare compatibleBaseIds' };

  const nameRaw = pickField(record, 'name', ['title'], changes);
  const name = textOr(nameRaw, id, 160);
  if (nameRaw === undefined) changes.push('added name from id');

  const descriptionRaw = own(record, 'description') ? record.description : '';
  const description = typeof descriptionRaw === 'string' ? descriptionRaw.slice(0, 1000) : '';
  if (!own(record, 'description')) changes.push('added description=""');

  const versionRaw = pickField(record, 'version', ['revision'], changes);
  const legacyVersion = Number.isInteger(versionRaw) && versionRaw > 0 ? versionRaw : null;
  if (legacyVersion === null) changes.push('version requires normalization');

  const statusRaw = pickField(record, 'status', ['state'], changes);
  let status;
  if (statusRaw !== undefined && statusRaw !== null && statusRaw !== '') {
    if (!['draft', 'published', 'archived'].includes(statusRaw)) return { error: 'invalid preset status' };
    status = statusRaw;
  } else if (typeof record.enabled === 'boolean') {
    status = record.enabled ? 'published' : 'archived';
    changes.push(`mapped enabled=${record.enabled} -> status=${status}`);
  } else {
    status = 'published';
    changes.push('added status=published');
  }

  const createdAtRaw = pickField(record, 'createdAt', ['created_at'], changes);
  const publishedAtRaw = pickField(record, 'publishedAt', ['published_at'], changes);
  const createdAt = isTime(createdAtRaw)
    ? createdAtRaw
    : (isTime(publishedAtRaw) ? publishedAtRaw : timestamp);
  if (!isTime(createdAtRaw)) changes.push(`normalized createdAt=${createdAt}`);

  const createdByRaw = pickField(record, 'createdBy', ['created_by'], changes);
  const createdBy = isUsername(createdByRaw) ? createdByRaw : FALLBACK_ACTOR;
  if (!isUsername(createdByRaw)) changes.push(`normalized createdBy=${createdBy}`);

  const publishedByRaw = pickField(record, 'publishedBy', ['published_by'], changes);
  let publishedAt = null;
  let publishedBy = null;
  if (status !== 'draft') {
    publishedAt = isTime(publishedAtRaw) ? publishedAtRaw : createdAt;
    publishedBy = isUsername(publishedByRaw) ? publishedByRaw : createdBy;
    if (!isTime(publishedAtRaw)) changes.push(`normalized publishedAt=${publishedAt}`);
    if (!isUsername(publishedByRaw)) changes.push(`normalized publishedBy=${publishedBy}`);
  } else if ((publishedAtRaw !== null && publishedAtRaw !== undefined) || (publishedByRaw !== null && publishedByRaw !== undefined)) {
    changes.push('cleared publish metadata for draft');
  }

  const canonical = {
    id,
    module,
    name,
    kind,
    description,
    compatibleBaseIds: clone(compatibleBaseIds),
    version: legacyVersion || 1,
    status,
    body: clone(body),
    protocolLock: clone(protocolLock),
    createdAt,
    createdBy,
    publishedAt,
    publishedBy
  };

  try {
    validatePreset(canonical);
  } catch {
    return { error: 'normalized preset still violates current schema' };
  }

  const canonicalKeys = new Set([
    'id', 'module', 'name', 'kind', 'description', 'compatibleBaseIds', 'version', 'status', 'body', 'protocolLock',
    'createdAt', 'createdBy', 'publishedAt', 'publishedBy'
  ]);
  const recognizedLegacyKeys = new Set([
    'presetId', 'key', 'moduleId', 'title', 'type', 'content', 'prompt', 'compatibleBases', 'revision', 'state',
    'created_at', 'created_by', 'published_at', 'published_by', 'enabled'
  ]);
  const removed = Object.keys(record).filter(key => !canonicalKeys.has(key) && !recognizedLegacyKeys.has(key));
  if (removed.length) changes.push(`removed unsupported fields: ${removed.sort().join(', ')}`);

  return {
    item: {
      preset: canonical,
      sourceIndex,
      legacyVersion,
      wasPublished: status === 'published',
      changes
    }
  };
}

function normalizePresetVersions(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.preset.id)) groups.set(item.preset.id, []);
    groups.get(item.preset.id).push(item);
  }

  for (const group of groups.values()) {
    const versions = group.map(item => item.legacyVersion);
    const uniquePositive = versions.every(version => Number.isInteger(version) && version > 0)
      && new Set(versions).size === versions.length;
    const contiguous = uniquePositive
      && [...versions].sort((a, b) => a - b).every((version, index) => version === index + 1);

    if (!contiguous) {
      group.sort((left, right) => {
        const leftVersion = left.legacyVersion ?? Number.MAX_SAFE_INTEGER;
        const rightVersion = right.legacyVersion ?? Number.MAX_SAFE_INTEGER;
        return leftVersion - rightVersion || left.sourceIndex - right.sourceIndex;
      });
      group.forEach((item, index) => {
        const next = index + 1;
        if (item.preset.version !== next || item.legacyVersion !== next) {
          item.changes.push(`renumbered version ${item.legacyVersion ?? 'missing'} -> ${next}`);
        }
        item.preset.version = next;
      });
    }

    const published = group.filter(item => item.wasPublished)
      .sort((left, right) => left.preset.version - right.preset.version);
    const winner = published.length ? published[published.length - 1] : null;
    for (const item of group) {
      if (item.wasPublished && item !== winner) {
        item.preset.status = 'archived';
        item.changes.push('archived duplicate published version');
      }
      if (item === winner) item.preset.status = 'published';
    }
  }

  return items.sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function sanitizeAuditSummary(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'body' || key === 'protocolLock') continue;
    if (Array.isArray(child)) result[key] = child.map(item => isPlainObject(item) ? sanitizeAuditSummary(item) : clone(item));
    else if (isPlainObject(child)) result[key] = sanitizeAuditSummary(child);
    else if (isJsonValue(child)) result[key] = child;
  }
  return result;
}

function normalizeAuditRecord(record, sourceIndex, timestamp, usedIDs) {
  if (!isPlainObject(record)) return { error: 'audit record is not an object' };
  const changes = [];
  let action = record.action;
  if (!['preset.draft_created', 'preset.published', 'preset.rolled_back'].includes(action)) {
    action = LEGACY_AUDIT_ACTIONS[action];
    if (action) changes.push(`mapped action -> ${action}`);
  }
  if (!action) return { error: 'unknown audit action' };

  const target = own(record, 'target') ? record.target : (record.presetId ?? record.key);
  if (!isPresetIdentifier(target)) return { error: 'missing or invalid audit target' };
  if (!own(record, 'target')) changes.push('mapped legacy target field');

  let id = typeof record.id === 'string' && record.id.trim() ? record.id : crypto.randomUUID();
  if (usedIDs.has(id)) {
    id = crypto.randomUUID();
    changes.push('replaced duplicate audit id');
  }
  usedIDs.add(id);

  const at = isTime(record.at) ? record.at : timestamp;
  if (!isTime(record.at)) changes.push(`normalized at=${at}`);
  const actor = isUsername(record.actor) ? record.actor : FALLBACK_ACTOR;
  if (!isUsername(record.actor)) changes.push(`normalized actor=${actor}`);

  const before = sanitizeAuditSummary(record.before);
  const after = sanitizeAuditSummary(record.after);
  if (record.before !== undefined && JSON.stringify(before) !== JSON.stringify(record.before)) changes.push('sanitized before summary');
  if (record.after !== undefined && JSON.stringify(after) !== JSON.stringify(record.after)) changes.push('sanitized after summary');

  const entry = { id, at, actor, action, target, before, after };
  try {
    validateAudit([entry]);
  } catch {
    return { error: 'normalized audit record still violates current schema' };
  }
  return { item: { entry, sourceIndex, changes } };
}

function migrationAuditEntry(timestamp, action, { source = 'migration', index = -1, target = '', changes = [], reason = '' } = {}) {
  return {
    id: crypto.randomUUID(),
    at: timestamp,
    action,
    source,
    index,
    target,
    changes: [...changes],
    ...(reason ? { reason } : {})
  };
}

function validateQuarantine(value) {
  return isPlainObject(value) && value.schemaVersion === QUARANTINE_SCHEMA_VERSION && Array.isArray(value.records);
}

function validateMigrationAudit(value) {
  return isPlainObject(value) && value.schemaVersion === MIGRATION_AUDIT_SCHEMA_VERSION && Array.isArray(value.entries);
}

function migrationPaths(systemDir) {
  return {
    presets: path.join(systemDir, 'presets.json'),
    audit: path.join(systemDir, 'preset-audit.json'),
    marker: path.join(systemDir, 'preset-store-schema.json'),
    quarantine: path.join(systemDir, 'preset-store-quarantine.json'),
    migrationAudit: path.join(systemDir, 'preset-store-migration-audit.json'),
    transaction: path.join(systemDir, 'preset-store-migration-transaction.json'),
    backups: path.join(systemDir, 'preset-store-backups'),
    lock: path.join(systemDir, 'preset-store.lock')
  };
}

function migratePresetStore({ systemDir, now = () => new Date(), lockTimeoutMs, lockRetryMs } = {}) {
  if (typeof systemDir !== 'string' || systemDir.length === 0) throw new Error('systemDir is required');
  ensurePrivateDirectory(systemDir);
  const files = migrationPaths(systemDir);
  const lockOptions = {
    ...(lockTimeoutMs === undefined ? {} : { timeoutMs: lockTimeoutMs }),
    ...(lockRetryMs === undefined ? {} : { retryMs: lockRetryMs })
  };
  const transactionPaths = [files.presets, files.audit, files.quarantine, files.migrationAudit, files.marker];

  function validateMigrationJournal(journal) {
    const byPath = new Map(journal.writes.map(write => [path.resolve(write.filePath), write.value]));
    const presets = byPath.get(path.resolve(files.presets));
    const audit = byPath.get(path.resolve(files.audit));
    const quarantine = byPath.get(path.resolve(files.quarantine));
    const migrationAudit = byPath.get(path.resolve(files.migrationAudit));
    const marker = byPath.get(path.resolve(files.marker));
    validatePresets(presets);
    validateAudit(audit);
    if (!validateQuarantine(quarantine)) throw migrationError('invalid quarantine transaction payload');
    if (!validateMigrationAudit(migrationAudit)) throw migrationError('invalid migration audit transaction payload');
    if (!isPlainObject(marker) || marker.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw migrationError('invalid schema marker transaction payload');
    }
  }

  return withJsonLock(files.lock, () => {
    recoverJsonTransaction(files.transaction, {
      allowedPaths: transactionPaths,
      validateJournal: validateMigrationJournal
    });

    const markerState = readJsonOrMissing(files.marker);
    if (markerState.found && isPlainObject(markerState.value) && markerState.value.schemaVersion === CURRENT_SCHEMA_VERSION) {
      return {
        migrated: false,
        marker: clone(markerState.value),
        quarantine: readJsonOrMissing(files.quarantine).found
          ? clone(readJsonOrMissing(files.quarantine).value)
          : { schemaVersion: QUARANTINE_SCHEMA_VERSION, records: [] }
      };
    }

    const timestamp = fixedNowISO(now);
    const presetsRaw = readRawFile(files.presets);
    const auditRaw = readRawFile(files.audit);

    const backupPresets = writeExclusiveBackup(files.backups, timestamp, 'presets.json', presetsRaw.raw);
    const backupAudit = writeExclusiveBackup(files.backups, timestamp, 'preset-audit.json', auditRaw.raw);

    const sourcePresets = parseArray(presetsRaw, 'presets.json');
    const sourceAudit = parseArray(auditRaw, 'preset-audit.json');

    const existingQuarantine = readOwnedObject(
      files.quarantine,
      { schemaVersion: QUARANTINE_SCHEMA_VERSION, records: [] },
      'preset quarantine'
    );
    if (!validateQuarantine(existingQuarantine)) throw migrationError('preset quarantine is invalid');
    const existingMigrationAudit = readOwnedObject(
      files.migrationAudit,
      { schemaVersion: MIGRATION_AUDIT_SCHEMA_VERSION, entries: [] },
      'preset migration audit'
    );
    if (!validateMigrationAudit(existingMigrationAudit)) throw migrationError('preset migration audit is invalid');

    const quarantine = clone(existingQuarantine);
    const migrationAudit = clone(existingMigrationAudit);
    migrationAudit.entries.push(migrationAuditEntry(timestamp, 'migration.started', {
      changes: [`source presets=${sourcePresets.length}`, `source audit=${sourceAudit.length}`]
    }));

    const normalizedItems = [];
    sourcePresets.forEach((record, index) => {
      const normalized = normalizePresetRecord(record, index, timestamp);
      if (normalized.error) {
        quarantine.records.push({ at: timestamp, source: 'presets', index, reason: normalized.error, record: clone(record) });
        migrationAudit.entries.push(migrationAuditEntry(timestamp, 'preset.quarantined', {
          source: 'presets', index, target: isPlainObject(record) ? String(record.id ?? record.presetId ?? record.key ?? '') : '', reason: normalized.error
        }));
        return;
      }
      normalizedItems.push(normalized.item);
    });

    normalizePresetVersions(normalizedItems);
    const presets = [];
    for (const item of normalizedItems) {
      try {
        validatePreset(item.preset);
        presets.push(item.preset);
      } catch {
        const original = sourcePresets[item.sourceIndex];
        const reason = 'preset became invalid after version/status normalization';
        quarantine.records.push({ at: timestamp, source: 'presets', index: item.sourceIndex, reason, record: clone(original) });
        migrationAudit.entries.push(migrationAuditEntry(timestamp, 'preset.quarantined', {
          source: 'presets', index: item.sourceIndex, target: item.preset.id, reason
        }));
        continue;
      }
      if (item.changes.length) {
        migrationAudit.entries.push(migrationAuditEntry(timestamp, 'preset.normalized', {
          source: 'presets', index: item.sourceIndex, target: item.preset.id, changes: item.changes
        }));
      }
    }

    const usedAuditIDs = new Set();
    const audit = [];
    sourceAudit.forEach((record, index) => {
      const normalized = normalizeAuditRecord(record, index, timestamp, usedAuditIDs);
      if (normalized.error) {
        quarantine.records.push({ at: timestamp, source: 'preset-audit', index, reason: normalized.error, record: clone(record) });
        migrationAudit.entries.push(migrationAuditEntry(timestamp, 'audit.quarantined', {
          source: 'preset-audit', index, target: isPlainObject(record) ? String(record.target ?? record.presetId ?? record.key ?? '') : '', reason: normalized.error
        }));
        return;
      }
      audit.push(normalized.item.entry);
      if (normalized.item.changes.length) {
        migrationAudit.entries.push(migrationAuditEntry(timestamp, 'audit.normalized', {
          source: 'preset-audit', index, target: normalized.item.entry.target, changes: normalized.item.changes
        }));
      }
    });

    validatePresets(presets);
    validateAudit(audit);

    const marker = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      migratedAt: timestamp,
      sourceDigest: combinedSourceDigest(presetsRaw.raw, auditRaw.raw),
      presetsDigest: sha256Buffer(jsonBytes(presets)),
      auditDigest: sha256Buffer(jsonBytes(audit)),
      backup: {
        presets: backupPresets ? safeRelative(systemDir, backupPresets) : null,
        audit: backupAudit ? safeRelative(systemDir, backupAudit) : null
      },
      quarantinedRecords: quarantine.records.length
    };
    migrationAudit.entries.push(migrationAuditEntry(timestamp, 'migration.completed', {
      changes: [
        `presets=${presets.length}`,
        `audit=${audit.length}`,
        `quarantined=${quarantine.records.length}`
      ]
    }));

    writeJsonTransaction(files.transaction, [
      { filePath: files.presets, value: presets },
      { filePath: files.audit, value: audit },
      { filePath: files.quarantine, value: quarantine },
      { filePath: files.migrationAudit, value: migrationAudit },
      { filePath: files.marker, value: marker }
    ], {
      allowedPaths: transactionPaths,
      validateJournal: validateMigrationJournal
    });

    return { migrated: true, marker: clone(marker), quarantine: clone(quarantine) };
  }, lockOptions);
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  migratePresetStore
};
