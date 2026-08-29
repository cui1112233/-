const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../system-store');

const DEFAULT_KEY = 'batch-production-default';
const ALLOWED_SETTING_KEYS = Object.freeze([
  'videoModelId',
  'videoModelVersionId',
  'videoModelName',
  'maxVideoDuration',
  'fixedSingleVideo',
  'aspectRatio',
  'prefixMode',
  'customPrefix',
  'style',
  'synopsis',
  'quality',
  'restriction',
  'negative',
  'scriptPromptPresetId',
  'assetPromptPresetId',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt',
  'subtitlePolicy',
  'constraintPrefixEnabled',
  'constraintQualityEnabled',
  'constraintRestrictionEnabled',
  'constraintNegativeEnabled',
  'constraintPrefixSource',
  'constraintPrefixPresetId',
  'constraintPrefixPersonalPromptId',
  'constraintQualitySource',
  'constraintQualityPresetId',
  'constraintQualityPersonalPromptId',
  'constraintRestrictionSource',
  'constraintRestrictionPresetId',
  'constraintRestrictionPersonalPromptId',
  'constraintNegativeSource',
  'constraintNegativePresetId',
  'constraintNegativePersonalPromptId'
]);

function now() {
  return new Date().toISOString();
}

function text(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanKey(value) {
  const result = text(value, 80).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return result || DEFAULT_KEY;
}

function sanitizeSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(ALLOWED_SETTING_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(source, key))
    .map(key => [key, clone(source[key])]));
}

function defaultRecord() {
  const timestamp = now();
  return {
    key: DEFAULT_KEY,
    name: '默认批量生产',
    version: 1,
    status: 'published',
    note: '系统默认批量生产配置',
    settings: {
      fixedSingleVideo: false,
      aspectRatio: '9:16',
      prefixMode: 'auto',
      scriptPromptPresetId: 'standard-short-drama',
      assetPromptPresetId: 'standard-asset-extraction',
      injectCharacterPrompt: true,
      injectScenePrompt: true,
      injectPropPrompt: true,
      subtitlePolicy: 'forbid-auto-dialogue-subtitle',
      constraintPrefixEnabled: true,
      constraintQualityEnabled: false,
      constraintRestrictionEnabled: false,
      constraintNegativeEnabled: false,
      constraintPrefixSource: 'system',
      constraintPrefixPresetId: '',
      constraintPrefixPersonalPromptId: '',
      constraintQualitySource: 'system',
      constraintQualityPresetId: '',
      constraintQualityPersonalPromptId: '',
      constraintRestrictionSource: 'system',
      constraintRestrictionPresetId: '',
      constraintRestrictionPersonalPromptId: '',
      constraintNegativeSource: 'system',
      constraintNegativePresetId: '',
      constraintNegativePersonalPromptId: ''
    },
    createdAt: timestamp,
    publishedAt: timestamp
  };
}

function normalizeData(value) {
  const versions = Array.isArray(value?.versions) ? value.versions : [];
  return { versions };
}

function createBatchFactoryConfigVersionStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('batch factory config version store requires systemDir');
  const filePath = path.join(systemDir, 'batch-factory-config-versions.json');

  function read() {
    const data = normalizeData(readJson(filePath, { versions: [] }));
    if (!data.versions.length) {
      data.versions = [defaultRecord()];
      writeJsonAtomic(filePath, data);
    }
    return data;
  }

  function write(data) {
    writeJsonAtomic(filePath, normalizeData(data));
  }

  function list() {
    return read().versions
      .slice()
      .sort((left, right) => String(right.publishedAt || right.createdAt || '').localeCompare(String(left.publishedAt || left.createdAt || '')))
      .map(clone);
  }

  function listForProduction() {
    return list().filter(record => record.status === 'published' || record.status === 'archived');
  }

  function get(key, version) {
    const normalizedKey = cleanKey(key);
    const numericVersion = Number(version);
    return list().find(record => record.key === normalizedKey && Number(record.version) === numericVersion) || null;
  }

  function getPublished(key) {
    const normalizedKey = cleanKey(key);
    return list().find(record => record.key === normalizedKey && record.status === 'published') || null;
  }

  function saveVersion(input = {}) {
    const data = read();
    const key = cleanKey(input.key);
    const existing = data.versions.filter(record => record.key === key);
    const version = existing.reduce((max, record) => Math.max(max, Number(record.version) || 0), 0) + 1;
    const record = {
      key,
      name: text(input.name, 100) || existing[0]?.name || '批量生产配置',
      version,
      status: 'draft',
      note: text(input.note, 500),
      settings: sanitizeSettings(input.settings),
      createdAt: now(),
      publishedAt: ''
    };
    data.versions.push(record);
    write(data);
    return clone(record);
  }

  function publish(key, version) {
    const data = read();
    const normalizedKey = cleanKey(key);
    const numericVersion = Number(version);
    const target = data.versions.find(record => record.key === normalizedKey && Number(record.version) === numericVersion);
    if (!target) return null;
    for (const record of data.versions) {
      if (record.key !== normalizedKey) continue;
      if (record === target) continue;
      if (record.status === 'published') record.status = 'archived';
    }
    target.status = 'published';
    target.publishedAt = now();
    write(data);
    return clone(target);
  }

  return {
    list,
    listForProduction,
    get,
    getPublished,
    saveVersion,
    publish,
    sanitizeSettings,
    filePath
  };
}

module.exports = {
  createBatchFactoryConfigVersionStore,
  sanitizeBatchFactoryVersionSettings: sanitizeSettings,
  DEFAULT_BATCH_FACTORY_CONFIG_KEY: DEFAULT_KEY
};
