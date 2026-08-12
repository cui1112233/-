const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCK_TIMEOUT_MS = 2000;
const LOCK_RETRY_MS = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function readJsonOrMissing(filePath) {
  try {
    return { found: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { found: false, value: undefined };
    throw error;
  }
}

function readJson(filePath, fallback) {
  const result = readJsonOrMissing(filePath);
  return result.found ? result.value : fallback;
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isValidTimestamp(value) {
  return typeof value === 'string' && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isValidLockMetadata(value) {
  return isPlainObject(value) && Object.keys(value).length === 3 && UUID_PATTERN.test(value.token)
    && Number.isInteger(value.pid) && value.pid > 0 && isValidTimestamp(value.createdAt);
}

function isValidClaimMetadata(value) {
  return isPlainObject(value) && Object.keys(value).length === 4 && UUID_PATTERN.test(value.nonce)
    && Number.isInteger(value.pid) && value.pid > 0 && isValidTimestamp(value.createdAt)
    && (value.lockToken === null || UUID_PATTERN.test(value.lockToken));
}

function isConfirmedDeadProcess(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return Boolean(error && error.code === 'ESRCH');
  }
}

function syncDirectoryBestEffort(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch {
    // The rename already made the new file name visible; directory sync is durability best effort.
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A failed close cannot make a completed rename uncommitted.
      }
    }
  }
}

// Atomically replaces a JSON file for readers. Parent-directory syncing is best effort only.
function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;

  ensurePrivateDirectory(directory);
  try {
    descriptor = fs.openSync(tempPath, 'w', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    syncDirectoryBestEffort(directory);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

function readLockState(lockPath) {
  try {
    const result = readJsonOrMissing(lockPath);
    if (!result.found) return { found: false, metadata: null };
    return { found: true, metadata: isValidLockMetadata(result.value) ? result.value : null };
  } catch {
    return { found: true, metadata: null };
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function lockPreparePath(lockPath, token) {
  return `${lockPath}.${token}.prepare`;
}

function claimPath(lockPath, nonce) {
  return `${lockPath}.${nonce}.stale-claim`;
}

function removePreparationLink(lockPath, token, lockStat) {
  const preparePath = lockPreparePath(lockPath, token);
  try {
    if (sameFile(lockStat, fs.statSync(preparePath))) safeUnlink(preparePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function removeDeadClaims(lockPath, lockStat) {
  const directory = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.`;
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.stale-claim')) continue;
    const metadataPath = path.join(directory, name);
    const referencePath = `${metadataPath}.ref`;
    let claim;
    try {
      claim = readJsonOrMissing(metadataPath);
    } catch {
      claim = { found: true, value: null };
    }
    if (claim.found && isValidClaimMetadata(claim.value) && !isConfirmedDeadProcess(claim.value.pid)) {
      continue;
    }
    try {
      if (sameFile(lockStat, fs.statSync(referencePath))) safeUnlink(referencePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    safeUnlink(metadataPath);
  }
}

function createStaleClaim(lockPath, lockToken) {
  const nonce = crypto.randomUUID();
  const metadataPath = claimPath(lockPath, nonce);
  const referencePath = `${metadataPath}.ref`;
  writeJsonAtomic(metadataPath, {
    nonce,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    lockToken
  });
  try {
    fs.linkSync(lockPath, referencePath);
  } catch (error) {
    safeUnlink(metadataPath);
    throw error;
  }
  return { metadataPath, referencePath };
}

function removeOwnClaim(claim) {
  safeUnlink(claim.referencePath);
  safeUnlink(claim.metadataPath);
}

function tryReclaimStaleLock(lockPath) {
  let state = readLockState(lockPath);
  if (!state.found) return true;
  if (state.metadata && !isConfirmedDeadProcess(state.metadata.pid)) return false;
  if (!state.metadata) {
    sleep(LOCK_RETRY_MS);
    state = readLockState(lockPath);
    if (!state.found) return true;
    if (state.metadata && !isConfirmedDeadProcess(state.metadata.pid)) return false;
  }

  let initialStat;
  try {
    initialStat = fs.statSync(lockPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return true;
    throw error;
  }
  removeDeadClaims(lockPath, initialStat);

  let claim;
  try {
    claim = createStaleClaim(lockPath, state.metadata ? state.metadata.token : null);
    const referenceStat = fs.statSync(claim.referencePath);
    const currentStat = fs.statSync(lockPath);
    if (!sameFile(referenceStat, currentStat)) return false;

    const current = readLockState(lockPath);
    if (!current.found) return true;
    if (current.metadata) {
      if (!isConfirmedDeadProcess(current.metadata.pid)) return false;
      removePreparationLink(lockPath, current.metadata.token, currentStat);
    }
    removeDeadClaims(lockPath, currentStat);

    const finalStat = fs.statSync(lockPath);
    if (!sameFile(referenceStat, finalStat) || fs.statSync(claim.referencePath).nlink !== 2) return false;
    fs.unlinkSync(lockPath);
    syncDirectoryBestEffort(path.dirname(lockPath));
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return true;
    throw error;
  } finally {
    if (claim) removeOwnClaim(claim);
  }
}

function releaseJsonLock(lockPath, token) {
  try {
    const lock = readJsonOrMissing(lockPath);
    if (!lock.found || !isValidLockMetadata(lock.value) || lock.value.token !== token) return;
    fs.unlinkSync(lockPath);
    syncDirectoryBestEffort(path.dirname(lockPath));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function createPreparedLock(lockPath) {
  const token = crypto.randomUUID();
  const preparePath = lockPreparePath(lockPath, token);
  const metadata = { token, pid: process.pid, createdAt: new Date().toISOString() };
  writeJsonAtomic(preparePath, metadata);
  return { token, preparePath };
}

function withJsonLock(lockPath, operation, { timeoutMs = LOCK_TIMEOUT_MS, retryMs = LOCK_RETRY_MS } = {}) {
  if (typeof operation !== 'function') throw new Error('Lock operation must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || !Number.isInteger(retryMs) || retryMs <= 0) {
    throw new Error('Invalid lock timeout');
  }

  ensurePrivateDirectory(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  let token;

  while (!token) {
    const prepared = createPreparedLock(lockPath);
    try {
      fs.linkSync(prepared.preparePath, lockPath);
      token = prepared.token;
    } catch (error) {
      safeUnlink(prepared.preparePath);
      if (!error || error.code !== 'EEXIST') throw error;
      if (tryReclaimStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring JSON store lock: ${lockPath}`);
      sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())));
      continue;
    }
    try {
      safeUnlink(prepared.preparePath);
    } catch {
      // The lock name already owns the inode; an orphaned prepare link cannot block reclaim.
    }
  }

  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new Error('Lock operation must be synchronous');
    }
    return result;
  } finally {
    releaseJsonLock(lockPath, token);
  }
}

function validateTransaction(journal, { allowedPaths, validateJournal } = {}) {
  if (!journal || journal.version !== 1 || typeof journal.id !== 'string' || typeof journal.createdAt !== 'string'
    || !Array.isArray(journal.writes) || journal.writes.length === 0) {
    throw new Error('Invalid JSON transaction journal');
  }

  const allowed = allowedPaths ? new Set(allowedPaths.map(filePath => path.resolve(filePath))) : null;
  const seen = new Set();
  for (const write of journal.writes) {
    if (!write || typeof write.filePath !== 'string' || !Object.hasOwn(write, 'value')) {
      throw new Error('Invalid JSON transaction journal');
    }
    const resolved = path.resolve(write.filePath);
    if ((allowed && !allowed.has(resolved)) || seen.has(resolved)) {
      throw new Error('Invalid JSON transaction journal');
    }
    seen.add(resolved);
  }
  if (validateJournal) validateJournal(journal);
}

function completeJsonTransaction(journalPath, journal) {
  for (const write of journal.writes) {
    writeJsonAtomic(write.filePath, write.value);
  }
  fs.unlinkSync(journalPath);
  syncDirectoryBestEffort(path.dirname(journalPath));
}

function recoverJsonTransaction(journalPath, options = {}) {
  const result = readJsonOrMissing(journalPath);
  if (!result.found) return false;

  validateTransaction(result.value, options);
  completeJsonTransaction(journalPath, result.value);
  return true;
}

function writeJsonTransaction(journalPath, writes, options = {}) {
  const journal = {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes
  };
  validateTransaction(journal, options);

  try {
    writeJsonAtomic(journalPath, journal);
    completeJsonTransaction(journalPath, journal);
  } catch (error) {
    try {
      const recovered = recoverJsonTransaction(journalPath, options);
      if (recovered) return;
    } catch (recoveryError) {
      const pending = new Error(`Transaction pending recovery: ${error.message}`);
      pending.cause = error;
      pending.recoveryError = recoveryError;
      throw pending;
    }
    throw error;
  }
}

module.exports = {
  readJson,
  readJsonOrMissing,
  writeJsonAtomic,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
};
