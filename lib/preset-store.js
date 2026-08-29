const crypto = require('node:crypto');
const path = require('node:path');

const {
  readJsonOrMissing,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
} = require('./system-store');
const { migratePresetStore } = require('./preset-store-migration');
const {
  KINDS,
  clone,
  isPresetIdentifier,
  isModuleIdentifier,
  isUsername,
  isText,
  isJsonValue,
  isCompatibleBaseIds,
  isValidConstraintPreset,
  publicPreset,
  auditSummary,
  validatePresets,
  validateAudit
} = require('./preset-store-schema');

function storeError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createPresetStore({ systemDir, lockTimeoutMs, lockRetryMs } = {}) {
  if (typeof systemDir !== 'string' || systemDir.length === 0) throw new Error('systemDir is required');

  // Backward compatibility is resolved before any strict runtime read. The
  // migration owns the same lock path, creates original-byte backups, and only
  // publishes a schema marker after the canonical store validates successfully.
  migratePresetStore({ systemDir, lockTimeoutMs, lockRetryMs });

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
    if (!isPresetIdentifier(id) || !isModuleIdentifier(module) || !isText(name, 160) || !KINDS.has(kind)
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
    if (!isUsername(actor) || !isPresetIdentifier(id) || !Number.isInteger(version) || version < 1) {
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
    if (!isUsername(actor) || !isPresetIdentifier(id) || !Number.isInteger(version) || version < 1) {
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
    if (!isPresetIdentifier(id) || !Number.isInteger(version) || version < 1) return null;
    return withStoreLock(() => {
      const preset = findVersion(readStateUnsafe(), id, version);
      return preset ? clone(preset) : null;
    });
  }

  function listCatalog(module) {
    if (!isModuleIdentifier(module)) throw storeError('Invalid module');
    return withStoreLock(() => readStateUnsafe().presets
      .filter(preset => preset.module === module && preset.status === 'published')
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(publicPreset));
  }

  function listAll(module) {
    if (!isModuleIdentifier(module)) throw storeError('Invalid module');
    return withStoreLock(() => readStateUnsafe().presets
      .filter(preset => preset.module === module)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
      .map(clone));
  }

  function getPublished(id) {
    if (!isPresetIdentifier(id)) return null;
    return withStoreLock(() => {
      const preset = publishedPreset(readStateUnsafe(), id);
      return preset ? clone(preset) : null;
    });
  }

  function resolveSelection({ module, presetIds } = {}) {
    if (!isModuleIdentifier(module) || !Array.isArray(presetIds) || presetIds.length === 0 || !presetIds.every(isPresetIdentifier)) {
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
