const crypto = require('node:crypto');

const { readJsonOrMissing, withJsonLock, writeJsonAtomic } = require('./system-store');

const TOKEN_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

function hashToken(token) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('Invalid session token');
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isValidSession(value) {
  return isPlainObject(value) && Object.keys(value).length === 2
    && typeof value.username === 'string' && USERNAME_PATTERN.test(value.username)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0;
}

function readSessions(filePath) {
  try {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return {};
    if (!isPlainObject(result.value) || !Object.entries(result.value).every(([digest, session]) => TOKEN_DIGEST_PATTERN.test(digest) && isValidSession(session))) {
      return null;
    }
    return result.value;
  } catch {
    return null;
  }
}

function sessionLockPath(filePath) {
  return `${filePath}.lock`;
}

function createPersistentSession(filePath, token, username, durationMs, now = Date.now()) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !USERNAME_PATTERN.test(username)
    || !Number.isSafeInteger(durationMs) || durationMs <= 0 || !Number.isSafeInteger(now)) {
    throw new Error('Invalid persistent session');
  }
  const expiresAt = now + durationMs;
  if (!Number.isSafeInteger(expiresAt)) throw new Error('Invalid persistent session');
  const digest = hashToken(token);

  return withJsonLock(sessionLockPath(filePath), () => {
    const sessions = readSessions(filePath);
    if (sessions === null) throw new Error('Persistent session store is invalid');
    sessions[digest] = { username, expiresAt };
    writeJsonAtomic(filePath, sessions);
  });
}

function getPersistentSession(filePath, token, now = Date.now()) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !Number.isSafeInteger(now)) return null;
  let digest;
  try {
    digest = hashToken(token);
  } catch {
    return null;
  }

  try {
    return withJsonLock(sessionLockPath(filePath), () => {
      const sessions = readSessions(filePath);
      if (sessions === null) return null;
      const session = sessions[digest];
      if (!session) return null;
      if (session.expiresAt <= now) {
        delete sessions[digest];
        writeJsonAtomic(filePath, sessions);
        return null;
      }
      return { username: session.username };
    });
  } catch {
    return null;
  }
}

function getPersistentUsername(filePath, token, now = Date.now()) {
  return getPersistentSession(filePath, token, now)?.username || null;
}

function revokePersistentSession(filePath, token) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  let digest;
  try {
    digest = hashToken(token);
  } catch {
    return false;
  }

  try {
    return withJsonLock(sessionLockPath(filePath), () => {
      const sessions = readSessions(filePath);
      if (sessions === null || !Object.hasOwn(sessions, digest)) return false;
      delete sessions[digest];
      writeJsonAtomic(filePath, sessions);
      return true;
    });
  } catch {
    return false;
  }
}

function listPersistentSessionsForUser(filePath, username, currentToken = '', now = Date.now()) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !USERNAME_PATTERN.test(String(username || ''))) return [];
  let currentDigest = null;
  try { currentDigest = currentToken ? hashToken(currentToken) : null; } catch { currentDigest = null; }
  try {
    return withJsonLock(sessionLockPath(filePath), () => {
      const sessions = readSessions(filePath);
      if (sessions === null) return [];
      let changed = false;
      const result = [];
      for (const [digest, session] of Object.entries(sessions)) {
        if (session.expiresAt <= now) {
          delete sessions[digest];
          changed = true;
          continue;
        }
        if (session.username !== username) continue;
        result.push({
          id: digest.slice(0, 12),
          expiresAt: session.expiresAt,
          current: Boolean(currentDigest && digest === currentDigest)
        });
      }
      if (changed) writeJsonAtomic(filePath, sessions);
      return result.sort((a, b) => b.expiresAt - a.expiresAt);
    });
  } catch {
    return [];
  }
}

function revokePersistentSessionsForUser(filePath, username, currentToken = '') {
  if (typeof filePath !== 'string' || filePath.length === 0 || !USERNAME_PATTERN.test(String(username || ''))) return 0;
  let currentDigest = null;
  try { currentDigest = currentToken ? hashToken(currentToken) : null; } catch { currentDigest = null; }
  try {
    return withJsonLock(sessionLockPath(filePath), () => {
      const sessions = readSessions(filePath);
      if (sessions === null) return 0;
      let removed = 0;
      for (const [digest, session] of Object.entries(sessions)) {
        if (session.username !== username || (currentDigest && digest === currentDigest)) continue;
        delete sessions[digest];
        removed += 1;
      }
      if (removed) writeJsonAtomic(filePath, sessions);
      return removed;
    });
  } catch {
    return 0;
  }
}

module.exports = {
  createPersistentSession,
  getPersistentSession,
  getPersistentUsername,
  revokePersistentSession,
  listPersistentSessionsForUser,
  revokePersistentSessionsForUser
};
