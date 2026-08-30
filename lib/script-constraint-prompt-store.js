const crypto = require('node:crypto');
const path = require('node:path');
const { readJsonOrMissing, withJsonLock, writeJsonTransaction, recoverJsonTransaction } = require('./system-store');

const CATEGORIES = new Set(['prefix', 'quality', 'restriction', 'negative']);
const USERNAME = /^[a-zA-Z0-9_-]{3,32}$/;
const MAX_NAMED_PER_CATEGORY = 100;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validText(value, max, allowNull = false) { return (allowNull && value === null) || (typeof value === 'string' && value.trim().length > 0 && value.length <= max); }
function validUsername(value) { return typeof value === 'string' && USERNAME.test(value); }
function validTime(value) { return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value))); }
function invalid() { throw new Error('Invalid personal prompt'); }

function createScriptConstraintPromptStore({ systemDir, lockTimeoutMs, lockRetryMs } = {}) {
  if (typeof systemDir !== 'string' || !systemDir) throw new Error('systemDir is required');
  const files = {
    prompts: path.join(systemDir, 'script-constraint-prompts.json'),
    transaction: path.join(systemDir, 'script-constraint-prompts-transaction.json'),
    lock: path.join(systemDir, 'script-constraint-prompts.lock')
  };
  const lockOptions = { ...(lockTimeoutMs === undefined ? {} : { timeoutMs: lockTimeoutMs }), ...(lockRetryMs === undefined ? {} : { retryMs: lockRetryMs }) };

  function validateRecord(record) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !validUsername(record.username)
      || !CATEGORIES.has(record.category) || !validText(record.name, 80, true) || !validText(record.body, 12000)
      || !validTime(record.createdAt) || !validTime(record.updatedAt) || !validTime(record.lastUsedAt)) invalid();
  }
  function validateState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.prompts)) invalid();
    const ids = new Set();
    const unnamed = new Set();
    const namedCounts = new Map();
    for (const record of state.prompts) {
      validateRecord(record);
      if (ids.has(record.id)) invalid();
      ids.add(record.id);
      const key = `${record.username}:${record.category}`;
      if (record.name === null) { if (unnamed.has(key)) invalid(); unnamed.add(key); }
      else namedCounts.set(key, (namedCounts.get(key) || 0) + 1);
    }
    for (const count of namedCounts.values()) if (count > MAX_NAMED_PER_CATEGORY) invalid();
    return state;
  }
  function readStateUnsafe() {
    recoverJsonTransaction(files.transaction, { allowedPaths: [files.prompts], validateJournal: journal => validateState(journal.writes[0]?.value) });
    const read = readJsonOrMissing(files.prompts);
    return validateState(read.found ? read.value : { version: 1, prompts: [] });
  }
  function writeState(state) {
    writeJsonTransaction(files.transaction, [{ filePath: files.prompts, value: state }], { allowedPaths: [files.prompts], validateJournal: journal => validateState(journal.writes[0]?.value) });
  }
  function sortRecords(records) {
    return records.sort((a, b) => {
      const usedA = a.lastUsedAt ? Date.parse(a.lastUsedAt) : -Infinity;
      const usedB = b.lastUsedAt ? Date.parse(b.lastUsedAt) : -Infinity;
      return usedB - usedA || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }
  function assertInput(username, input) {
    if (!validUsername(username) || !input || !CATEGORIES.has(input.category) || !validText(input.name, 80, true) || !validText(input.body, 12000)) invalid();
  }
  function withStore(operation) { return withJsonLock(files.lock, operation, lockOptions); }
  return {
    files,
    list(username, category) {
      if (!validUsername(username) || !CATEGORIES.has(category)) invalid();
      return withStore(() => clone(sortRecords(readStateUnsafe().prompts.filter(item => item.username === username && item.category === category))));
    },
    getOwned(username, id) {
      if (!validUsername(username) || typeof id !== 'string') return null;
      return withStore(() => { const item = readStateUnsafe().prompts.find(record => record.username === username && record.id === id); return item ? clone(item) : null; });
    },
    createOrSaveDraft(username, input) {
      assertInput(username, input);
      return withStore(() => {
        const state = readStateUnsafe(); const now = new Date().toISOString();
        let record = input.name === null ? state.prompts.find(item => item.username === username && item.category === input.category && item.name === null) : null;
        if (record) { record.body = input.body.trim(); record.updatedAt = now; }
        else {
          if (input.name !== null && state.prompts.filter(item => item.username === username && item.category === input.category && item.name !== null).length >= MAX_NAMED_PER_CATEGORY) invalid();
          record = { id: crypto.randomUUID(), username, category: input.category, name: input.name === null ? null : input.name.trim(), body: input.body.trim(), createdAt: now, updatedAt: now, lastUsedAt: null };
          state.prompts.push(record);
        }
        writeState(state); return clone(record);
      });
    },
    update(username, id, patch) {
      return withStore(() => {
        const state = readStateUnsafe(); const record = state.prompts.find(item => item.username === username && item.id === id); if (!record) return null;
        const name = Object.hasOwn(patch || {}, 'name') ? patch.name : record.name;
        const body = Object.hasOwn(patch || {}, 'body') ? patch.body : record.body;
        assertInput(username, { category: record.category, name, body });
        record.name = name === null ? null : name.trim(); record.body = body.trim(); record.updatedAt = new Date().toISOString(); writeState(state); return clone(record);
      });
    },
    remove(username, id) {
      return withStore(() => { const state = readStateUnsafe(); const index = state.prompts.findIndex(item => item.username === username && item.id === id); if (index < 0) return false; state.prompts.splice(index, 1); writeState(state); return true; });
    },
    markUsed(username, ids) {
      if (!validUsername(username) || !Array.isArray(ids)) invalid();
      return withStore(() => { const state = readStateUnsafe(); const wanted = new Set(ids.filter(id => typeof id === 'string')); const now = new Date().toISOString(); let changed = false; for (const record of state.prompts) if (record.username === username && wanted.has(record.id)) { record.lastUsedAt = now; changed = true; } if (changed) writeState(state); return changed; });
    }
  };
}

module.exports = { createScriptConstraintPromptStore, CATEGORIES };
