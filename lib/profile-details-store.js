const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

function profileError(message) {
  const error = new Error(message);
  error.code = 'INVALID';
  return error;
}

function normalizeText(value, fallback, max, label, { nullable = true } = {}) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return nullable ? null : '';
  if (typeof value !== 'string') throw profileError(`${label}不合法`);
  const text = value.trim();
  if (!text) return nullable ? null : '';
  if (text.length > max) throw profileError(`${label}不能超过 ${max} 个字符`);
  return text;
}

function normalizeEmail(value, fallback) {
  const text = normalizeText(value, fallback, 120, '邮箱');
  if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw profileError('邮箱格式不正确');
  return text?.toLowerCase() || text;
}

function normalizePhone(value, fallback) {
  const text = normalizeText(value, fallback, 32, '手机号');
  if (text && !/^[+\d][\d\s()-]{5,31}$/.test(text)) throw profileError('手机号格式不正确');
  return text;
}

function createProfileDetailsStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'member-profile-details.json');
  const lockPath = path.join(systemDir, 'member-profile-details.lock');

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error('Invalid member profile details store');
    return result.value;
  }

  function defaultProfile(username) {
    return { username, bio: null, phone: null, email: null, teamTitle: null, updatedAt: null };
  }

  function get(username) {
    if (!USERNAME_PATTERN.test(String(username || ''))) return null;
    return withJsonLock(lockPath, () => {
      const item = readUnsafe().find(entry => entry.username === username);
      return item ? { ...item } : defaultProfile(username);
    });
  }

  function list() {
    return withJsonLock(lockPath, () => readUnsafe().map(item => ({ ...item })));
  }

  function findByEmail(emailValue) {
    const email = normalizeEmail(emailValue, null);
    if (!email) return [];
    return withJsonLock(lockPath, () => readUnsafe().filter(item => item.email === email).map(item => ({ ...item })));
  }

  function update(username, patch = {}) {
    if (!USERNAME_PATTERN.test(String(username || ''))) throw profileError('账号不合法');
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      let item = rows.find(entry => entry.username === username);
      if (!item) {
        item = defaultProfile(username);
        rows.push(item);
      }
      item.bio = normalizeText(patch.bio, item.bio, 240, '个人简介');
      item.phone = normalizePhone(patch.phone, item.phone);
      item.email = normalizeEmail(patch.email, item.email);
      item.teamTitle = normalizeText(patch.teamTitle, item.teamTitle, 60, '团队职务');
      item.updatedAt = new Date().toISOString();
      writeJsonAtomic(filePath, rows);
      return { ...item };
    });
  }

  function clear(username) {
    if (!USERNAME_PATTERN.test(String(username || ''))) throw profileError('账号不合法');
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      const index = rows.findIndex(item => item.username === username);
      if (index === -1) return defaultProfile(username);
      rows.splice(index, 1);
      writeJsonAtomic(filePath, rows);
      return defaultProfile(username);
    });
  }

  return { filePath, get, list, findByEmail, update, clear };
}

module.exports = { createProfileDetailsStore };
