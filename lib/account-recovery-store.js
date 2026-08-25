const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const TOKEN_TTL_MS = 30 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

function recoveryError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 120) throw recoveryError('邮箱格式不正确');
  return email;
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!USERNAME_PATTERN.test(username)) throw recoveryError('账号不合法');
  return username;
}

function publicRecord(record) {
  if (!record) return null;
  const { tokenDigest, ...rest } = record;
  return { ...rest };
}

function createAccountRecoveryStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'account-recovery.json');
  const lockPath = path.join(systemDir, 'account-recovery.lock');

  function emptyState() {
    return { verifiedEmails: [], emailTokens: [], passwordResetTokens: [], deletionTombstones: [] };
  }

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return emptyState();
    const state = result.value;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid account recovery store');
    return {
      verifiedEmails: Array.isArray(state.verifiedEmails) ? state.verifiedEmails : [],
      emailTokens: Array.isArray(state.emailTokens) ? state.emailTokens : [],
      passwordResetTokens: Array.isArray(state.passwordResetTokens) ? state.passwordResetTokens : [],
      deletionTombstones: Array.isArray(state.deletionTombstones) ? state.deletionTombstones : []
    };
  }

  function writeUnsafe(state) {
    writeJsonAtomic(filePath, state);
  }

  function prune(state) {
    const now = Date.now();
    state.emailTokens = state.emailTokens.filter(item => !item.usedAt && Date.parse(item.expiresAt) > now - TOKEN_TTL_MS);
    state.passwordResetTokens = state.passwordResetTokens.filter(item => !item.usedAt && Date.parse(item.expiresAt) > now - TOKEN_TTL_MS);
  }

  function issueEmailVerification(usernameValue, emailValue, ttlMs = TOKEN_TTL_MS) {
    const username = normalizeUsername(usernameValue);
    const email = normalizeEmail(emailValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      prune(state);
      state.emailTokens = state.emailTokens.filter(item => item.username !== username);
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      const record = {
        id: crypto.randomUUID(), username, email, tokenDigest: digest(token),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + Math.max(60_000, Number(ttlMs) || TOKEN_TTL_MS)).toISOString(),
        usedAt: null
      };
      state.emailTokens.push(record);
      writeUnsafe(state);
      return { token, record: publicRecord(record) };
    });
  }

  function revokeEmailVerification(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const before = state.emailTokens.length;
      state.emailTokens = state.emailTokens.filter(item => item.username !== username || item.usedAt);
      if (before !== state.emailTokens.length) writeUnsafe(state);
      return before - state.emailTokens.length;
    });
  }

  function verifyEmailToken(tokenValue) {
    const tokenDigest = digest(tokenValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const record = state.emailTokens.find(item => item.tokenDigest === tokenDigest);
      if (!record) throw recoveryError('验证链接无效', 'NOT_FOUND');
      if (record.usedAt) throw recoveryError('验证链接已使用', 'CONFLICT');
      if (Date.parse(record.expiresAt) <= Date.now()) throw recoveryError('验证链接已过期', 'CONFLICT');
      const now = new Date().toISOString();
      record.usedAt = now;
      state.verifiedEmails = state.verifiedEmails.filter(item => item.username !== record.username);
      state.verifiedEmails.push({ username: record.username, email: record.email, verifiedAt: now });
      writeUnsafe(state);
      return { username: record.username, email: record.email, verifiedAt: now };
    });
  }

  function emailStatus(usernameValue, currentEmailValue) {
    const username = normalizeUsername(usernameValue);
    const currentEmail = currentEmailValue ? normalizeEmail(currentEmailValue) : null;
    return withJsonLock(lockPath, () => {
      const verified = readUnsafe().verifiedEmails.find(item => item.username === username);
      return {
        email: currentEmail,
        verified: Boolean(currentEmail && verified && verified.email === currentEmail),
        verifiedAt: currentEmail && verified?.email === currentEmail ? verified.verifiedAt : null
      };
    });
  }

  function verifiedUsernameForEmail(emailValue) {
    const email = normalizeEmail(emailValue);
    return withJsonLock(lockPath, () => readUnsafe().verifiedEmails.find(item => item.email === email)?.username || null);
  }

  function issuePasswordReset(usernameValue, emailValue, ttlMs = TOKEN_TTL_MS) {
    const username = normalizeUsername(usernameValue);
    const email = normalizeEmail(emailValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const verified = state.verifiedEmails.find(item => item.username === username && item.email === email);
      if (!verified) throw recoveryError('邮箱尚未验证', 'FORBIDDEN');
      prune(state);
      state.passwordResetTokens = state.passwordResetTokens.filter(item => item.username !== username || item.usedAt);
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      const record = {
        id: crypto.randomUUID(), username, email, tokenDigest: digest(token),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + Math.max(60_000, Number(ttlMs) || TOKEN_TTL_MS)).toISOString(),
        usedAt: null
      };
      state.passwordResetTokens.push(record);
      writeUnsafe(state);
      return { token, record: publicRecord(record) };
    });
  }

  function revokePasswordReset(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const before = state.passwordResetTokens.length;
      state.passwordResetTokens = state.passwordResetTokens.filter(item => item.username !== username || item.usedAt);
      if (before !== state.passwordResetTokens.length) writeUnsafe(state);
      return before - state.passwordResetTokens.length;
    });
  }

  function consumePasswordReset(tokenValue) {
    const tokenDigest = digest(tokenValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const record = state.passwordResetTokens.find(item => item.tokenDigest === tokenDigest);
      if (!record) throw recoveryError('重置链接无效', 'NOT_FOUND');
      if (record.usedAt) throw recoveryError('重置链接已使用', 'CONFLICT');
      if (Date.parse(record.expiresAt) <= Date.now()) throw recoveryError('重置链接已过期', 'CONFLICT');
      record.usedAt = new Date().toISOString();
      writeUnsafe(state);
      return publicRecord(record);
    });
  }

  function markDeleted(usernameValue, deletedByValue, reason = '') {
    const username = normalizeUsername(usernameValue);
    const deletedBy = normalizeUsername(deletedByValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      if (state.deletionTombstones.some(item => item.username === username)) throw recoveryError('账号已经永久删除', 'CONFLICT');
      const tombstone = {
        username,
        deletedBy,
        deletedAt: new Date().toISOString(),
        reason: String(reason || '').trim().slice(0, 300)
      };
      state.deletionTombstones.push(tombstone);
      state.emailTokens = state.emailTokens.filter(item => item.username !== username);
      state.passwordResetTokens = state.passwordResetTokens.filter(item => item.username !== username);
      state.verifiedEmails = state.verifiedEmails.filter(item => item.username !== username);
      writeUnsafe(state);
      return { ...tombstone };
    });
  }

  function isDeleted(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => Boolean(readUnsafe().deletionTombstones.find(item => item.username === username)));
  }

  function getTombstone(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => {
      const item = readUnsafe().deletionTombstones.find(entry => entry.username === username);
      return item ? { ...item } : null;
    });
  }

  return {
    filePath,
    issueEmailVerification,
    revokeEmailVerification,
    verifyEmailToken,
    emailStatus,
    verifiedUsernameForEmail,
    issuePasswordReset,
    revokePasswordReset,
    consumePasswordReset,
    markDeleted,
    isDeleted,
    getTombstone
  };
}

module.exports = { createAccountRecoveryStore, recoveryError, normalizeEmail, TOKEN_TTL_MS };
