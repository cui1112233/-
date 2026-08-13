const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic } = require('../system-store');
const {
  assertValidProjectId,
  assertValidUsername,
  isPlainObject
} = require('./contracts');

const MAX_DRAFT_BYTES = 5 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LEASE_ACTIONS = new Set(['acquire', 'heartbeat', 'release']);

function assertInstanceId(instanceId) {
  if (typeof instanceId !== 'string' || !instanceId.trim() || instanceId.length > 256) {
    throw new Error('Invalid instance id');
  }
  return instanceId;
}

function assertOperation(operation) {
  if (typeof operation !== 'string' || !operation.trim() || operation.length > 256) {
    throw new Error('Invalid operation');
  }
  return operation;
}

function cloneDraft(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid draft value');
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneDraft);
  if (!isPlainObject(value)) throw new Error('Invalid draft value');

  const copy = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe draft field');
    copy[key] = cloneDraft(value[key]);
  }
  return copy;
}

function assertDraft(value) {
  if (!isPlainObject(value)) throw new Error('Invalid draft');
  const copy = cloneDraft(value);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > MAX_DRAFT_BYTES) {
    throw new Error('Draft exceeds 5MB');
  }
  return copy;
}

function createNovelPanelRuntime({ usersDir, now = () => Date.now(), leaseTtlMs = 90_000 } = {}) {
  if (typeof usersDir !== 'string' || !usersDir) throw new Error('Invalid users directory');
  if (typeof now !== 'function') throw new Error('Invalid clock');
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0) throw new Error('Invalid lease TTL');

  const leases = new Map();
  const operations = new Set();

  function leaseKey(username, projectId) {
    return `${username}\u0000${projectId}`;
  }

  function operationKey(username, operation) {
    return `${username}\u0000${operation}`;
  }

  function response({ acquired = false, released = false, holder = null } = {}) {
    return {
      acquired,
      released,
      holder_instance_id: holder ? holder.instanceId : null,
      expires_at: holder ? holder.expiresAt : null
    };
  }

  function activeLease(key, timestamp) {
    const current = leases.get(key);
    if (current && current.expiresAt <= timestamp) leases.delete(key);
    return leases.get(key) || null;
  }

  function draftPath(username) {
    return path.join(usersDir, username, 'novel-panel', 'draft.json');
  }

  return {
    lease(username, { action, projectId, instanceId, force = false } = {}) {
      assertValidUsername(username);
      assertValidProjectId(projectId);
      assertInstanceId(instanceId);
      if (!LEASE_ACTIONS.has(action)) throw new Error('Invalid lease action');
      if (typeof force !== 'boolean') throw new Error('Invalid force option');

      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new Error('Invalid clock value');
      const key = leaseKey(username, projectId);
      const current = activeLease(key, timestamp);

      if (action === 'release') {
        if (!current || current.instanceId !== instanceId) return response({ holder: current });
        leases.delete(key);
        return response({ released: true });
      }

      if (action === 'heartbeat' && (!current || current.instanceId !== instanceId)) {
        return response({ holder: current });
      }
      if (current && current.instanceId !== instanceId && !force) return response({ holder: current });

      const holder = {
        instanceId,
        expiresAt: timestamp + leaseTtlMs
      };
      leases.set(key, holder);
      return response({ acquired: true, holder });
    },

    beginOperation(username, operation) {
      assertValidUsername(username);
      assertOperation(operation);
      const key = operationKey(username, operation);
      if (operations.has(key)) return null;

      operations.add(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        operations.delete(key);
      };
    },

    saveDraft(username, draft) {
      assertValidUsername(username);
      const copy = assertDraft(draft);
      writeJsonAtomic(draftPath(username), copy);
      return cloneDraft(copy);
    },

    loadDraft(username) {
      assertValidUsername(username);
      let stored;
      try {
        stored = readJsonOrMissing(draftPath(username));
      } catch {
        throw new Error('Invalid draft');
      }
      return stored.found ? assertDraft(stored.value) : null;
    }
  };
}

module.exports = { createNovelPanelRuntime };
