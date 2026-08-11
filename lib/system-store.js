const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  'EACCES', 'EBADF', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'
]);

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

function syncDirectoryBestEffort(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!error || !UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  let renamed = false;

  ensurePrivateDirectory(directory);
  try {
    descriptor = fs.openSync(tempPath, 'w', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    renamed = true;
    fs.chmodSync(filePath, 0o600);
    syncDirectoryBestEffort(directory);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!renamed) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError;
      }
    }
    throw error;
  }
}

function validateTransaction(journal, allowedPaths) {
  if (!journal || journal.version !== 1 || !Array.isArray(journal.writes) || journal.writes.length === 0) {
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
}

function completeJsonTransaction(journalPath, journal) {
  for (const write of journal.writes) {
    writeJsonAtomic(write.filePath, write.value);
  }
  fs.unlinkSync(journalPath);
  syncDirectoryBestEffort(path.dirname(journalPath));
}

function recoverJsonTransaction(journalPath, { allowedPaths } = {}) {
  const result = readJsonOrMissing(journalPath);
  if (!result.found) return false;

  validateTransaction(result.value, allowedPaths);
  completeJsonTransaction(journalPath, result.value);
  return true;
}

function writeJsonTransaction(journalPath, writes, { allowedPaths } = {}) {
  const journal = {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes
  };
  validateTransaction(journal, allowedPaths);

  try {
    writeJsonAtomic(journalPath, journal);
    completeJsonTransaction(journalPath, journal);
  } catch (error) {
    try {
      const recovered = recoverJsonTransaction(journalPath, { allowedPaths });
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
  writeJsonTransaction,
  recoverJsonTransaction
};
