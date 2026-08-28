const fs = require('node:fs');
const path = require('node:path');
const { ensureUserDir, getUserDir } = require('../shared');

const sessions = new Map();

function now() { return new Date().toISOString(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function defaultConfig() {
  return {
    enabled: false,
    username: '',
    passwordMasked: false,
    profiles: [],
    styleCatalog: [],
    organizationCatalog: { fieldName: '', items: [] },
    selectedOrganization: '',
    selectedProfile: '',
    retryTimes: 1,
    updatedAt: ''
  };
}

function normalizeCatalog(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(item => ({
    id: String(item?.id ?? item?.value ?? '').trim(),
    name: String(item?.name ?? item?.label ?? '').trim()
  })).filter(item => item.id && item.name && !seen.has(item.id) && (seen.add(item.id) || true));
}

function normalizeProfiles(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => ({
    id: String(item?.id || `profile_${index + 1}`).trim(),
    name: String(item?.name || `121 配置档 ${index + 1}`).trim(),
    configId: String(item?.configId ?? item?.config_id ?? '').trim(),
    isDefault: item?.isDefault === true || item?.is_default === true,
    platformId: String(item?.platformId ?? item?.platform_id ?? '').trim(),
    gender: String(item?.gender || '').replace('频', '').trim(),
    style: String(item?.style || '').trim(),
    advanced: object(item?.advanced)
  })).filter(item => item.id && item.name);
}

function normalizeConfig(value = {}, previous = {}) {
  const source = { ...defaultConfig(), ...object(previous), ...object(value) };
  const organizationSource = object(source.organizationCatalog);
  const organizationItems = normalizeCatalog(organizationSource.items);
  const selectedOrganization = String(source.selectedOrganization || '').trim();
  return {
    enabled: source.enabled === true,
    username: String(source.username || '').trim().slice(0, 160),
    passwordMasked: source.passwordMasked === true,
    profiles: normalizeProfiles(source.profiles),
    styleCatalog: normalizeCatalog(source.styleCatalog),
    organizationCatalog: {
      fieldName: String(organizationSource.fieldName || '').trim().slice(0, 160),
      items: organizationItems
    },
    selectedOrganization: organizationItems.some(item => item.id === selectedOrganization) ? selectedOrganization : '',
    selectedProfile: String(source.selectedProfile || '').trim().slice(0, 180),
    retryTimes: Math.max(0, Math.min(Number(source.retryTimes) || 1, 5)),
    updatedAt: source.updatedAt || now()
  };
}

function createBatchFactory121Store() {
  function filePath(username) {
    ensureUserDir(username);
    return path.join(getUserDir(username), 'batch-factory-121.json');
  }

  function read(username) {
    const target = filePath(username);
    if (!fs.existsSync(target)) return { config: defaultConfig(), history: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return {
        config: normalizeConfig(parsed?.config),
        history: Array.isArray(parsed?.history) ? parsed.history.slice(-300) : []
      };
    } catch (_) {
      return { config: defaultConfig(), history: [] };
    }
  }

  function write(username, data) {
    const target = filePath(username);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, target);
  }

  function getConfig(username) { return read(username).config; }

  function saveConfig(username, input) {
    const data = read(username);
    data.config = normalizeConfig(input, data.config);
    data.config.updatedAt = now();
    write(username, data);
    return data.config;
  }

  function patchConfig(username, patch) {
    return saveConfig(username, { ...getConfig(username), ...object(patch) });
  }

  function setSession(username, cookie) {
    const value = String(cookie || '').trim();
    if (!value) throw new Error('121 会话 Cookie 不能为空');
    sessions.set(username, { cookie: value, verifiedAt: now() });
    return { verifiedAt: sessions.get(username).verifiedAt };
  }

  function getSession(username) { return sessions.get(username) || null; }
  function clearSession(username) { sessions.delete(username); }

  function appendHistory(username, entry) {
    const data = read(username);
    data.history.push({ at: now(), ...object(entry) });
    data.history = data.history.slice(-300);
    write(username, data);
    return data.history.at(-1);
  }

  function listHistory(username) { return read(username).history.slice().reverse(); }

  return {
    getConfig,
    saveConfig,
    patchConfig,
    setSession,
    getSession,
    clearSession,
    appendHistory,
    listHistory
  };
}

module.exports = { createBatchFactory121Store, normalizeConfig, normalizeCatalog, normalizeProfiles };
