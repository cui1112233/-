const fs = require('node:fs');
const path = require('node:path');
const { ensureUserDir, getUserDir } = require('./shared');

function now() {
  return new Date().toISOString();
}

function normalizeBody(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createUserPromptLibraryStore() {
  function filePath(username) {
    ensureUserDir(username);
    return path.join(getUserDir(username), 'prompt-library.json');
  }

  function read(username) {
    const target = filePath(username);
    if (!fs.existsSync(target)) return { overrides: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return {
        overrides: parsed?.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
          ? parsed.overrides
          : {}
      };
    } catch (_) {
      return { overrides: {} };
    }
  }

  function write(username, data) {
    const target = filePath(username);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, target);
  }

  function get(username, promptId) {
    const value = read(username).overrides[String(promptId || '')];
    if (!value || typeof value !== 'object') return null;
    const body = normalizeBody(value.body);
    if (!body) return null;
    return {
      id: String(promptId),
      body,
      version: Number.isInteger(Number(value.version)) && Number(value.version) > 0 ? Number(value.version) : 1,
      createdAt: String(value.createdAt || ''),
      updatedAt: String(value.updatedAt || '')
    };
  }

  function save(username, promptId, body) {
    const id = String(promptId || '').trim();
    const normalized = normalizeBody(body);
    if (!id) throw new Error('提示词ID不能为空');
    if (!normalized) throw new Error('提示词正文不能为空');
    if (normalized.length > 120000) throw new Error('提示词正文过长');
    const data = read(username);
    const previous = data.overrides[id];
    const timestamp = now();
    const next = {
      body: normalized,
      version: previous ? Number(previous.version || 1) + 1 : 1,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    data.overrides[id] = next;
    write(username, data);
    return { id, ...next };
  }

  function reset(username, promptId) {
    const id = String(promptId || '').trim();
    if (!id) return false;
    const data = read(username);
    if (!data.overrides[id]) return false;
    delete data.overrides[id];
    write(username, data);
    return true;
  }

  function list(username) {
    return Object.entries(read(username).overrides).map(([id, value]) => ({
      id,
      body: normalizeBody(value?.body),
      version: Number(value?.version || 1),
      createdAt: String(value?.createdAt || ''),
      updatedAt: String(value?.updatedAt || '')
    })).filter(item => item.body);
  }

  return { get, save, reset, list };
}

module.exports = { createUserPromptLibraryStore };
