const crypto = require('node:crypto');
const path = require('node:path');

const {
  readJsonOrMissing,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
} = require('./system-store');

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const KINDS = new Set(['base', 'addon']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const PRESET_FIELDS = new Set([
  'id', 'module', 'name', 'kind', 'description', 'compatibleBaseIds', 'version', 'status', 'body', 'protocolLock',
  'createdAt', 'createdBy', 'publishedAt', 'publishedBy'
]);
const AUDIT_FIELDS = new Set(['id', 'at', 'actor', 'action', 'target', 'before', 'after']);
const AUDIT_ACTIONS = new Set(['preset.draft_created', 'preset.published', 'preset.rolled_back']);

function storeError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value, allowedFields) {
  return isPlainObject(value) && Object.keys(value).every(key => allowedFields.has(key));
}

function isIdentifier(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isUsername(value) {
  return typeof value === 'string' && USERNAME_PATTERN.test(value);
}

function isTime(value) {
  return typeof value === 'string' && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isText(value, maxLength, { allowEmpty = false } = {}) {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainObject(value) && Object.values(value).every(isJsonValue);
}

function isCompatibleBaseIds(value) {
  return Array.isArray(value) && value.every(isIdentifier) && new Set(value).size === value.length;
}

function isValidConstraintPreset(id, module, kind, protocolLock) {
  if (protocolLock?.format !== 'constraint') return true;
  const category = protocolLock.category;
  return module === 'script'
    && kind === 'addon'
    && ['prefix', 'quality', 'restriction', 'negative'].includes(category)
    && id.startsWith(`script-constraint-${category}-`);
}

function publicPreset(preset) {
  return {
    id: preset.id,
    module: preset.module,
    name: preset.name,
    kind: preset.kind,
    description: preset.description,
    compatibleBaseIds: [...preset.compatibleBaseIds],
    version: preset.version,
    status: preset.status,
    ...(preset.protocolLock?.format === 'constraint' ? { constraintCategory: preset.protocolLock.category } : {}),
    ...(preset.protocolLock?.format === 'extract' ? { extractionPreset: true } : {})
  };
}

function auditSummary(preset) {
  const { protocolLock, ...summary } = publicPreset(preset);
  return summary;
}

function containsProtectedField(value) {
  if (Array.isArray(value)) return value.some(containsProtectedField);
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some(key => key === 'body' || key === 'protocolLock' || containsProtectedField(value[key]));
}

function isAuditSummary(value) {
  return value === null || (isPlainObject(value) && isJsonValue(value) && !containsProtectedField(value));
}

function createPresetStore({ systemDir, lockTimeoutMs, lockRetryMs } = {}) {
  if (typeof systemDir !== 'string' || systemDir.length === 0) throw new Error('systemDir is required');

  const files = {
    presets: path.join(systemDir, 'presets.json'),
    audit: path.join(systemDir, 'preset-audit.json'),
    transaction: path.join(systemDir, 'preset-store-transaction.json'),
    lock: path.join(systemDir, 'preset-store.lock')
  };
  const transactionPaths = [files.presets, files.audit];
  const lockOptions = {
    ...(lockTimeoutMs === undefined ? {} : { timeoutMs: lockTimeoutMs }),
    ...(lockRetryMs === undefined ? {} : { retryMs: lockRetryMs })
  };

  function validatePreset(preset) {
    if (!hasOnlyFields(preset, PRESET_FIELDS) || !isIdentifier(preset.id) || !isIdentifier(preset.module)
      || !isText(preset.name, 160) || !KINDS.has(preset.kind) || !isText(preset.description, 1000, { allowEmpty: true })
      || !isCompatibleBaseIds(preset.compatibleBaseIds) || !Number.isInteger(preset.version) || preset.version < 1
      || !STATUSES.has(preset.status) || !isJsonValue(preset.body) || !isJsonValue(preset.protocolLock)
      || !isTime(preset.createdAt) || !isUsername(preset.createdBy)) {
      throw new Error('Invalid preset store');
    }
    if (preset.kind === 'base' && preset.compatibleBaseIds.length > 0) throw new Error('Invalid preset store');
    if (preset.status === 'draft') {
      if (preset.publishedAt !== null || preset.publishedBy !== null) throw new Error('Invalid preset store');
    } else if (!isTime(preset.publishedAt) || !isUsername(preset.publishedBy)) {
      throw new Error('Invalid preset store');
    }
  }

  function validatePresets(presets) {
    if (!Array.isArray(presets)) throw new Error('Invalid preset store');
    const versionsById = new Map();
    const publishedById = new Map();
    for (const preset of presets) {
      validatePreset(preset);
      if (!versionsById.has(preset.id)) versionsById.set(preset.id, new Set());
      const versions = versionsById.get(preset.id);
      if (versions.has(preset.version)) throw new Error('Invalid preset store');
      versions.add(preset.version);
      if (preset.status === 'published') {
        if (publishedById.has(preset.id)) throw new Error('Invalid preset store');
        publishedById.set(preset.id, preset);
      }
    }
    for (const versions of versionsById.values()) {
      for (let version = 1; version <= versions.size; version += 1) {
        if (!versions.has(version)) throw new Error('Invalid preset store');
      }
    }
    return presets;
  }

  function validateAudit(audit) {
    if (!Array.isArray(audit)) throw new Error('Invalid preset audit store');
    const ids = new Set();
    for (const entry of audit) {
      if (!hasOnlyFields(entry, AUDIT_FIELDS) || typeof entry.id !== 'string' || !isTime(entry.at)
        || !isUsername(entry.actor) || !AUDIT_ACTIONS.has(entry.action) || !isIdentifier(entry.target)
        || !isAuditSummary(entry.before) || !isAuditSummary(entry.after) || ids.has(entry.id)) {
        throw new Error('Invalid preset audit store');
      }
      ids.add(entry.id);
    }
    return audit;
  }

  function readArray(filePath, label) {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error(`Invalid ${label} store`);
    return result.value;
  }

  function validateJournalWrites(journal) {
    const current = {
      presets: readArray(files.presets, 'preset'),
      audit: readArray(files.audit, 'preset audit')
    };
    for (const write of journal.writes) {
      if (path.resolve(write.filePath) === path.resolve(files.presets)) current.presets = write.value;
      if (path.resolve(write.filePath) === path.resolve(files.audit)) current.audit = write.value;
    }
    validatePresets(current.presets);
    validateAudit(current.audit);
  }

  function recoverPendingTransactionUnsafe() {
    return recoverJsonTransaction(files.transaction, {
      allowedPaths: transactionPaths,
      validateJournal: validateJournalWrites
    });
  }

  function readStateUnsafe() {
    recoverPendingTransactionUnsafe();
    return {
      presets: validatePresets(readArray(files.presets, 'preset')),
      audit: validateAudit(readArray(files.audit, 'preset audit'))
    };
  }

  function withStoreLock(operation) {
    return withJsonLock(files.lock, operation, lockOptions);
  }

  function writeState(state) {
    writeJsonTransaction(files.transaction, [
      { filePath: files.presets, value: state.presets },
      { filePath: files.audit, value: state.audit }
    ], {
      allowedPaths: transactionPaths,
      validateJournal: validateJournalWrites
    });
  }

  function appendAudit(state, actor, action, target, before, after) {
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      target,
      before,
      after
    };
    validateAudit([entry]);
    state.audit.push(entry);
  }

  function findVersion(state, id, version) {
    return state.presets.find(preset => preset.id === id && preset.version === version) || null;
  }

  function publishedPreset(state, id) {
    return state.presets.find(preset => preset.id === id && preset.status === 'published') || null;
  }

  function createDraft(actor, input = {}) {
    if (!isUsername(actor)) throw storeError('Invalid actor');
    const { id, module, name, kind, description, compatibleBaseIds, body, protocolLock = null } = input;
    if (!isIdentifier(id) || !isIdentifier(module) || !isText(name, 160) || !KINDS.has(kind)
      || !isText(description, 1000, { allowEmpty: true }) || !isCompatibleBaseIds(compatibleBaseIds)
      || body === undefined || !isJsonValue(body) || !isJsonValue(protocolLock)
      || (kind === 'base' && compatibleBaseIds.length > 0)
      || !isValidConstraintPreset(id, module, kind, protocolLock)) {
      throw storeError('Invalid preset draft');
    }
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const version = state.presets.reduce((maximum, preset) => preset.id === id ? Math.max(maximum, preset.version) : maximum, 0) + 1;
      const preset = {
        id,
        module,
        name: name.trim(),
        kind,
        description,
        compatibleBaseIds: [...compatibleBaseIds],
        version,
        status: 'draft',
        body: clone(body),
        protocolLock: clone(protocolLock),
        createdAt: new Date().toISOString(),
        createdBy: actor,
        publishedAt: null,
        publishedBy: null
      };
      state.presets.push(preset);
      appendAudit(state, actor, 'preset.draft_created', id, null, auditSummary(preset));
      writeState(state);
      return publicPreset(preset);
    });
  }

  function publish(actor, id, version) {
    if (!isUsername(actor) || !isIdentifier(id) || !Number.isInteger(version) || version < 1) {
      throw storeError('Invalid publish request');
    }
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const preset = findVersion(state, id, version);
      if (!preset) throw storeError('Preset version not found', 'NOT_FOUND');
      if (preset.status !== 'draft') throw storeError('Only draft presets can be published', 'CONFLICT');
      const current = publishedPreset(state, id);
      if (current) current.status = 'archived';
      preset.status = 'published';
      preset.publishedAt = new Date().toISOString();
      preset.publishedBy = actor;
      appendAudit(state, actor, 'preset.published', id, current ? auditSummary(current) : null, auditSummary(preset));
      writeState(state);
      return publicPreset(preset);
    });
  }

  function rollback(actor, id, version) {
    if (!isUsername(actor) || !isIdentifier(id) || !Number.isInteger(version) || version < 1) {
      throw storeError('Invalid rollback request');
    }
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const preset = findVersion(state, id, version);
      if (!preset) throw storeError('Preset version not found', 'NOT_FOUND');
      if (preset.status !== 'archived') throw storeError('Only archived presets can be rolled back', 'CONFLICT');
      const current = publishedPreset(state, id);
      if (!current) throw storeError('No published preset to roll back', 'CONFLICT');
      current.status = 'archived';
      preset.status = 'published';
      appendAudit(state, actor, 'preset.rolled_back', id, auditSummary(current), auditSummary(preset));
      writeState(state);
      return publicPreset(preset);
    });
  }

  function getVersion(id, version) {
    if (!isIdentifier(id) || !Number.isInteger(version) || version < 1) return null;
    return withStoreLock(() => {
      const preset = findVersion(readStateUnsafe(), id, version);
      return preset ? clone(preset) : null;
    });
  }

  function listCatalog(module) {
    if (!isIdentifier(module)) throw storeError('Invalid module');
    return withStoreLock(() => readStateUnsafe().presets
      .filter(preset => preset.module === module && preset.status === 'published')
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(publicPreset));
  }

  function listAll(module) {
    if (!isIdentifier(module)) throw storeError('Invalid module');
    return withStoreLock(() => readStateUnsafe().presets
      .filter(preset => preset.module === module)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
      .map(clone));
  }

  function getPublished(id) {
    if (!isIdentifier(id)) return null;
    return withStoreLock(() => {
      const preset = publishedPreset(readStateUnsafe(), id);
      return preset ? clone(preset) : null;
    });
  }

  function resolveSelection({ module, presetIds } = {}) {
    if (!isIdentifier(module) || !Array.isArray(presetIds) || presetIds.length === 0 || !presetIds.every(isIdentifier)) {
      throw storeError('Invalid preset selection');
    }
    if (new Set(presetIds).size !== presetIds.length) throw storeError('Preset selection contains duplicate ids');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const selected = presetIds.map(id => {
        const preset = publishedPreset(state, id);
        if (!preset) throw storeError(`Preset is not published: ${id}`);
        if (preset.module !== module) throw storeError('Preset module mismatch');
        return preset;
      });
      const bases = selected.filter(preset => preset.kind === 'base');
      const addons = selected.filter(preset => preset.kind === 'addon');
      if (bases.length !== 1) {
        throw storeError(bases.length > 1 ? 'Preset selection contains multiple bases' : 'Preset selection requires one published base');
      }
      if (addons.some(addon => !addon.compatibleBaseIds.includes(bases[0].id))) {
        throw storeError('Addon is not compatible with selected base');
      }
      return { base: clone(bases[0]), addons: addons.map(clone) };
    });
  }

  return {
    createDraft,
    publish,
    rollback,
    getVersion,
    getPublished,
    listAll,
    listCatalog,
    resolveSelection,
    listAudit: () => withStoreLock(() => clone(readStateUnsafe().audit)),
    files: { ...files }
  };
}

module.exports = { createPresetStore, publicPreset };
