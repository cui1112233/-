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

function isValidLockMetadata(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === 3 && UUID_PATTERN.test(value.token)
    && Number.isInteger(value.pid) && value.pid > 0 && typeof value.createdAt === 'string'
    && ISO_TIME_PATTERN.test(value.createdAt) && !Number.isNaN(Date.parse(value.createdAt));
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

function releaseJsonLock(lockPath, token) {
  try {
    const lock = readJsonOrMissing(lockPath);
    if (!lock.found || !lock.value || lock.value.token !== token) return;
    fs.unlinkSync(lockPath);
    syncDirectoryBestEffort(path.dirname(lockPath));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function tryReclaimStaleLock(lockPath) {
  let lock;
  try {
    lock = readJsonOrMissing(lockPath);
  } catch {
    return false;
  }
  if (!lock.found || !isValidLockMetadata(lock.value) || !isConfirmedDeadProcess(lock.value.pid)) {
    return false;
  }

  const claimPath = `${lockPath}.${lock.value.token}.stale-claim`;
  let claimStat;
  try {
    fs.linkSync(lockPath, claimPath);
    claimStat = fs.statSync(claimPath);
    const currentStat = fs.statSync(lockPath);
    const claim = readJsonOrMissing(claimPath);
    if (!claim.found || !sameFile(claimStat, currentStat) || !isValidLockMetadata(claim.value)
      || claim.value.token !== lock.value.token || claim.value.pid !== lock.value.pid
      || !isConfirmedDeadProcess(claim.value.pid)) {
      return false;
    }
    fs.unlinkSync(lockPath);
    syncDirectoryBestEffort(path.dirname(lockPath));
    return true;
  } catch (error) {
    if (error && (error.code === 'EEXIST' || error.code === 'ENOENT' || error.code === 'EPERM')) return false;
    throw error;
  } finally {
    if (claimStat) {
      try {
        if (sameFile(claimStat, fs.statSync(claimPath))) fs.unlinkSync(claimPath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
  }
}

function withJsonLock(lockPath, operation, { timeoutMs = LOCK_TIMEOUT_MS, retryMs = LOCK_RETRY_MS } = {}) {
  if (typeof operation !== 'function') throw new Error('Lock operation must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || !Number.isInteger(retryMs) || retryMs <= 0) {
    throw new Error('Invalid lock timeout');
  }

  ensurePrivateDirectory(path.dirname(lockPath));
  const token = crypto.randomUUID();
  const deadline = Date.now() + timeoutMs;
  let descriptor;

  while (descriptor === undefined) {
    let candidate;
    try {
      candidate = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(candidate, JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
      fs.fsyncSync(candidate);
      descriptor = candidate;
    } catch (error) {
      if (candidate !== undefined) {
        try {
          fs.closeSync(candidate);
        } finally {
          try {
            releaseJsonLock(lockPath, token);
          } catch {
            // A partial lock record is never removed without proving ownership.
          }
        }
      }
      if (!error || error.code !== 'EEXIST') throw error;
      if (tryReclaimStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring JSON store lock: ${lockPath}`);
      sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())));
    }
  }

  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new Error('Lock operation must be synchronous');
    }
    return result;
  } finally {
    try {
      fs.closeSync(descriptor);
    } finally {
      releaseJsonLock(lockPath, token);
    }
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
