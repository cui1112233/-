const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { resolveBoundVideoSettings } = require('./batch-factory');

const SCRIPT_PROMPT_PRESETS = new Set([
  'standard-short-drama',
  'commercial-dynamic-storyboard',
  'spatial-continuity-storyboard'
]);
const ASSET_PROMPT_PRESETS = new Set(['standard-asset-extraction']);

function text(value, max = 50000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
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
    subtitlePolicy: value.subtitlePolicy === 'allow' ? 'allow' : 'forbid-auto-dialogue-subtitle'
  };
}

function normalizePublishSettings(value = {}, previous = {}) {
  const rawCount = Number(value.jieyaVideoCount ?? previous.jieyaVideoCount ?? 4);
  const jieyaVideoCount = Number.isInteger(rawCount) ? Math.max(0, Math.min(8, rawCount)) : 4;
  return {
    jieyaVideoCount,
    aiHead: '自定义AI头部',
    materialReuse: boolOr(value.materialReuse, boolOr(previous.materialReuse, false)),
    horizontalFlip: boolOr(value.horizontalFlip, boolOr(previous.horizontalFlip, false)),
    profileId: text(value.profileId ?? previous.profileId, 160),
    organizationId: text(value.organizationId ?? previous.organizationId, 160)
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

function createBatchFactoryControlsRouter({ store = createBatchFactoryStore(), shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.put('/batches/:batchId/settings', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const merged = { ...batch.settings, ...input };
    try {
      const resolved = await resolveBoundVideoSettings(req, merged, shuihuoGateway);
      const normalized = store.normalizeSettings(resolved);
      const extras = normalizeProductionExtras(input, batch.settings || {});
      store.updateBatch(req.username, batch.id, target => {
        target.settings = { ...normalized, ...extras };
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
    const previous = item.settingsOverride || {};
    const next = {
      prefixMode: ['inherit', 'auto', 'manual'].includes(input.prefixMode) ? input.prefixMode : (previous.prefixMode || 'inherit'),
      customPrefix: text(input.customPrefix ?? previous.customPrefix),
      quality: text(input.quality ?? previous.quality),
      restriction: text(input.restriction ?? previous.restriction),
      negative: text(input.negative ?? previous.negative),
      injectCharacterPrompt: input.injectCharacterPrompt === undefined ? previous.injectCharacterPrompt : Boolean(input.injectCharacterPrompt),
      injectScenePrompt: input.injectScenePrompt === undefined ? previous.injectScenePrompt : Boolean(input.injectScenePrompt),
      injectPropPrompt: input.injectPropPrompt === undefined ? previous.injectPropPrompt : Boolean(input.injectPropPrompt)
    };
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
