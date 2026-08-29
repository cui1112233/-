const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const {
  resolveVideoManagementAccountStatus,
  startVideoManagementAccountRelogin
} = require('../lib/batch-factory/video-management-account');
const { resolveBoundVideoSettings } = require('./batch-factory');

const SCRIPT_PROMPT_PRESETS = new Set([
  'standard-short-drama',
  'commercial-dynamic-storyboard',
  'spatial-continuity-storyboard'
]);
const ASSET_PROMPT_PRESETS = new Set(['standard-asset-extraction']);
const CONSTRAINT_SOURCES = new Set(['system', 'personal', 'draft']);

function text(value, max = 50000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function constraintSource(value, fallback = 'system') {
  return CONSTRAINT_SOURCES.has(value) ? value : (CONSTRAINT_SOURCES.has(fallback) ? fallback : 'system');
}

function normalizeProductionExtras(value = {}, previous = {}) {
  const scriptPromptPresetId = SCRIPT_PROMPT_PRESETS.has(value.scriptPromptPresetId)
    ? value.scriptPromptPresetId
    : (SCRIPT_PROMPT_PRESETS.has(previous.scriptPromptPresetId) ? previous.scriptPromptPresetId : 'standard-short-drama');
  const assetPromptPresetId = ASSET_PROMPT_PRESETS.has(value.assetPromptPresetId)
    ? value.assetPromptPresetId
    : (ASSET_PROMPT_PRESETS.has(previous.assetPromptPresetId) ? previous.assetPromptPresetId : 'standard-asset-extraction');
  return {
    scriptPromptPresetId,
    assetPromptPresetId,
    injectCharacterPrompt: boolOr(value.injectCharacterPrompt, boolOr(previous.injectCharacterPrompt, true)),
    injectScenePrompt: boolOr(value.injectScenePrompt, boolOr(previous.injectScenePrompt, true)),
    injectPropPrompt: boolOr(value.injectPropPrompt, boolOr(previous.injectPropPrompt, true)),
    subtitlePolicy: value.subtitlePolicy === 'allow' ? 'allow' : (previous.subtitlePolicy === 'allow' && value.subtitlePolicy === undefined ? 'allow' : 'forbid-auto-dialogue-subtitle'),
    constraintPrefixEnabled: boolOr(value.constraintPrefixEnabled, boolOr(previous.constraintPrefixEnabled, true)),
    constraintQualityEnabled: boolOr(value.constraintQualityEnabled, boolOr(previous.constraintQualityEnabled, false)),
    constraintRestrictionEnabled: boolOr(value.constraintRestrictionEnabled, boolOr(previous.constraintRestrictionEnabled, false)),
    constraintNegativeEnabled: boolOr(value.constraintNegativeEnabled, boolOr(previous.constraintNegativeEnabled, false)),
    constraintPrefixSource: constraintSource(value.constraintPrefixSource, previous.constraintPrefixSource),
    constraintPrefixPresetId: text(value.constraintPrefixPresetId ?? previous.constraintPrefixPresetId, 160),
    constraintPrefixPersonalPromptId: text(value.constraintPrefixPersonalPromptId ?? previous.constraintPrefixPersonalPromptId, 160),
    constraintQualitySource: constraintSource(value.constraintQualitySource, previous.constraintQualitySource),
    constraintQualityPresetId: text(value.constraintQualityPresetId ?? previous.constraintQualityPresetId, 160),
    constraintQualityPersonalPromptId: text(value.constraintQualityPersonalPromptId ?? previous.constraintQualityPersonalPromptId, 160),
    constraintRestrictionSource: constraintSource(value.constraintRestrictionSource, previous.constraintRestrictionSource),
    constraintRestrictionPresetId: text(value.constraintRestrictionPresetId ?? previous.constraintRestrictionPresetId, 160),
    constraintRestrictionPersonalPromptId: text(value.constraintRestrictionPersonalPromptId ?? previous.constraintRestrictionPersonalPromptId, 160),
    constraintNegativeSource: constraintSource(value.constraintNegativeSource, previous.constraintNegativeSource),
    constraintNegativePresetId: text(value.constraintNegativePresetId ?? previous.constraintNegativePresetId, 160),
    constraintNegativePersonalPromptId: text(value.constraintNegativePersonalPromptId ?? previous.constraintNegativePersonalPromptId, 160)
  };
}

function normalizePublishSettings(value = {}, previous = {}) {
  const rawProfileVersion = Number(value.configProfileVersion ?? previous.configProfileVersion ?? 0);
  return {
    materialReuse: boolOr(value.materialReuse, boolOr(previous.materialReuse, false)),
    horizontalFlip: boolOr(value.horizontalFlip, boolOr(previous.horizontalFlip, false)),
    configProfileKey: text(value.configProfileKey ?? previous.configProfileKey, 80),
    configProfileName: text(value.configProfileName ?? previous.configProfileName, 100),
    configProfileVersion: Number.isInteger(rawProfileVersion) && rawProfileVersion > 0 ? rawProfileVersion : 0,
    configProfileSyncedAt: text(value.configProfileSyncedAt ?? previous.configProfileSyncedAt, 40)
  };
}

function invalidateItemAfterSourceEdit(item, sourceText, txtText) {
  item.sourceText = sourceText;
  item.txtText = txtText || sourceText;
  item.txtFileName = item.bookId ? `${item.bookId}.txt` : item.txtFileName;
  item.hookDraft = '';
  item.approvedHookScript = '';
  item.hookMeta = null;
  item.directorResult = null;
  item.promptVersions = {};
  item.videoPromptErrors = {};
  item.production = null;
  item.productionResults = [];
  item.productionSubmissionError = null;
  item.status = 'pending';
  item.error = '';
  item.manuallyEdited = true;
}

function publicConfigVersion(record) {
  if (!record) return null;
  return {
    key: record.key,
    name: record.name,
    version: record.version,
    status: record.status,
    note: record.note || '',
    settings: record.settings || {},
    createdAt: record.createdAt || '',
    publishedAt: record.publishedAt || ''
  };
}

function createBatchFactoryControlsRouter({
  store = createBatchFactoryStore(),
  shuihuoGateway,
  configVersionStore,
  videoManagementAccountAdapter
} = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.get('/publish-config-versions', (req, res) => {
    if (!configVersionStore) return res.json({ versions: [], latestByKey: {} });
    const versions = configVersionStore.listForPublishing().map(publicConfigVersion);
    const latestByKey = {};
    for (const record of versions) {
      if (record.status === 'published') latestByKey[record.key] = record;
    }
    return res.json({ versions, latestByKey });
  });

  router.get('/admin/publish-config-versions', (req, res) => {
    if (req.auth?.account?.isOwner !== true) return res.status(403).json({ error: '仅开发账号可管理批量发布版本配置' });
    return res.json({ versions: configVersionStore ? configVersionStore.list().map(publicConfigVersion) : [] });
  });

  router.post('/admin/publish-config-versions', (req, res) => {
    if (req.auth?.account?.isOwner !== true) return res.status(403).json({ error: '仅开发账号可管理批量发布版本配置' });
    if (!configVersionStore) return res.status(503).json({ error: '批量发布版本配置存储未启用' });
    try {
      const record = configVersionStore.saveVersion(req.body || {});
      return res.status(201).json({ version: publicConfigVersion(record) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '保存批量发布版本配置失败' });
    }
  });

  router.post('/admin/publish-config-versions/:key/:version/publish', (req, res) => {
    if (req.auth?.account?.isOwner !== true) return res.status(403).json({ error: '仅开发账号可管理批量发布版本配置' });
    if (!configVersionStore) return res.status(503).json({ error: '批量发布版本配置存储未启用' });
    const record = configVersionStore.publish(req.params.key, req.params.version);
    if (!record) return res.status(404).json({ error: '批量发布版本配置不存在' });
    return res.json({ version: publicConfigVersion(record) });
  });

  router.get('/video-management-account/status', async (req, res) => {
    const status = await resolveVideoManagementAccountStatus({
      accountAdapter: videoManagementAccountAdapter,
      username: req.username
    });
    return res.json(status);
  });

  router.post('/video-management-account/relogin', async (req, res) => {
    const result = await startVideoManagementAccountRelogin({
      accountAdapter: videoManagementAccountAdapter,
      username: req.username
    });
    if (result.state !== 'started') return res.status(503).json(result);
    return res.json(result);
  });

  router.put('/batches/:batchId/settings', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const merged = { ...batch.settings, ...input };
    const requestedMode = input.productionMode === 'viral'
      ? 'viral'
      : (input.productionMode === 'original' ? 'original' : batch.mode);
    try {
      const resolved = await resolveBoundVideoSettings(req, merged, shuihuoGateway);
      const normalized = store.normalizeSettings(resolved);
      const extras = normalizeProductionExtras(input, batch.settings || {});
      store.updateBatch(req.username, batch.id, target => {
        target.settings = { ...normalized, ...extras };
        if ((target.items || []).every(item => item.status === 'pending')) target.mode = requestedMode;
      });
      return res.json({ batch: store.getBatch(req.username, batch.id) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '保存生产统一设置失败' });
    }
  });

  router.put('/batches/:batchId/publish-settings', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    store.updateBatch(req.username, batch.id, target => {
      target.publishSettings = normalizePublishSettings(input, target.publishSettings || {});
    });
    return res.json({ batch: store.getBatch(req.username, batch.id) });
  });

  router.put('/batches/:batchId/items/:itemId/source', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const sourceText = text(req.body?.sourceText, 120000);
    if (!sourceText) return res.status(400).json({ error: '小说正文不能为空' });
    const txtText = text(req.body?.txtText ?? sourceText, 2000000);
    store.updateItem(req.username, batch.id, item.id, target => {
      invalidateItemAfterSourceEdit(target, sourceText, txtText);
    });
    store.appendItemActivity?.(req.username, batch.id, item.id, {
      type: 'source-edit',
      status: 'pending',
      message: '小说正文已修改，旧导演结果和未完成生产结果已失效，请重新开始导演。'
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.put('/batches/:batchId/items/:itemId/overrides', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    if (req.body?.reset === true || input.__reset === true) {
      store.updateItem(req.username, batch.id, item.id, target => { target.settingsOverride = {}; });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    }
    const previous = item.settingsOverride && typeof item.settingsOverride === 'object' ? item.settingsOverride : {};
    const next = { ...previous };
    const stringKeys = [
      'customPrefix', 'quality', 'restriction', 'negative',
      'constraintPrefixPresetId', 'constraintPrefixPersonalPromptId',
      'constraintQualityPresetId', 'constraintQualityPersonalPromptId',
      'constraintRestrictionPresetId', 'constraintRestrictionPersonalPromptId',
      'constraintNegativePresetId', 'constraintNegativePersonalPromptId'
    ];
    for (const key of stringKeys) if (hasOwn(input, key)) next[key] = text(input[key]);
    if (hasOwn(input, 'prefixMode') && ['inherit', 'auto', 'manual'].includes(input.prefixMode)) next.prefixMode = input.prefixMode;
    for (const key of ['constraintPrefixSource', 'constraintQualitySource', 'constraintRestrictionSource', 'constraintNegativeSource']) {
      if (hasOwn(input, key)) next[key] = constraintSource(input[key], previous[key]);
    }
    for (const key of [
      'injectCharacterPrompt', 'injectScenePrompt', 'injectPropPrompt',
      'constraintPrefixEnabled', 'constraintQualityEnabled', 'constraintRestrictionEnabled', 'constraintNegativeEnabled'
    ]) {
      if (hasOwn(input, key)) next[key] = Boolean(input[key]);
    }
    store.updateItem(req.username, batch.id, item.id, target => {
      target.settingsOverride = next;
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  return router;
}

module.exports = {
  createBatchFactoryControlsRouter,
  normalizeProductionExtras,
  normalizePublishSettings,
  SCRIPT_PROMPT_PRESETS,
  ASSET_PROMPT_PRESETS
};
