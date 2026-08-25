const crypto = require('node:crypto');

const { readJsonOrMissing, withJsonLock, writeJsonAtomic } = require('./system-store');

const TOKEN_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const SESSION_FIELDS = new Set(['username', 'expiresAt', 'issuedAt', 'browser', 'os', 'ipHint']);

function hashToken(token) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('Invalid session token');
  return crypto.createHash('sha256').update(token).digest('hex');
}

function persistentSessionIdForToken(token) {
  try {
    return hashToken(token).slice(0, 12);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isOptionalShortText(value, max = 80) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max);
}

function isValidSession(value) {
  return isPlainObject(value)
    && Object.keys(value).every(key => SESSION_FIELDS.has(key))
    && typeof value.username === 'string' && USERNAME_PATTERN.test(value.username)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0
    && (value.issuedAt === undefined || (Number.isSafeInteger(value.issuedAt) && value.issuedAt > 0))
    && isOptionalShortText(value.browser)
    && isOptionalShortText(value.os)
    && isOptionalShortText(value.ipHint, 64);
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

function normalizeMetadata(value, issuedAt) {
  const metadata = value && typeof value === 'object' ? value : {};
  const shortText = (candidate, max) => typeof candidate === 'string' && candidate.trim()
    ? candidate.trim().slice(0, max)
    : null;
  const browser = shortText(metadata.browser, 80);
  const os = shortText(metadata.os, 80);
  const ipHint = shortText(metadata.ipHint, 64);
  return {
    issuedAt: Number.isSafeInteger(issuedAt) && issuedAt > 0 ? issuedAt : Date.now(),
    ...(browser ? { browser } : {}),
    ...(os ? { os } : {}),
    ...(ipHint ? { ipHint } : {})
  };
}

function createPersistentSession(filePath, token, username, durationMs, now = Date.now(), metadata = null) {
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
    sessions[digest] = {
      username,
      expiresAt,
      ...(metadata ? normalizeMetadata(metadata, now) : {})
    };
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
          current: Boolean(currentDigest && digest === currentDigest),
          issuedAt: session.issuedAt || null,
          browser: session.browser || null,
          os: session.os || null,
          ipHint: session.ipHint || null
        });
      }
      if (changed) writeJsonAtomic(filePath, sessions);
      return result.sort((a, b) => (b.issuedAt || b.expiresAt) - (a.issuedAt || a.expiresAt));
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
  revokePersistentSessionsForUser,
  persistentSessionIdForToken
};
