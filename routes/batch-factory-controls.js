const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { normalizeProductionLineCount } = require('../lib/batch-factory/production-text');
const { resolveItemSettings, resolveVideoSettings, BOOK_OVERRIDE_KEYS, VIDEO_OVERRIDE_KEYS } = require('../lib/batch-factory/effective-settings');
const { isSelectablePrompt } = require('../lib/batch-factory/prompt-selection');
const { resolveBoundVideoSettings } = require('./batch-factory');

const DIRECTOR_SETTING_KEYS = new Set([
  'productionMode',
  'productionLineCount',
  'scriptPromptPresetId',
  'assetPromptPresetId',
  'videoModelId',
  'videoModelVersionId',
  'videoModelMaxDuration',
  'maxVideoDuration',
  'fixedSingleVideo',
  'exactDuration',
  'style',
  'synopsis'
]);

const GENERATION_SETTING_KEYS = new Set([
  'aspectRatio',
  'prefixMode',
  'customPrefix',
  'quality',
  'restriction',
  'negative',
  'subtitlePolicy',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt'
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function text(value, max = 50000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizePromptId(value, previous, category, fallback) {
  const requested = text(value, 180);
  if (requested) {
    if (!isSelectablePrompt(requested, category)) throw new Error(`所选${category === 'script' ? '剧本' : '人物场景'}提示词不存在或尚未发布`);
    return requested;
  }
  const old = text(previous, 180);
  return old && isSelectablePrompt(old, category) ? old : fallback;
}

function normalizeProductionExtras(value = {}, previous = {}) {
  return {
    scriptPromptPresetId: normalizePromptId(value.scriptPromptPresetId, previous.scriptPromptPresetId, 'script', 'standard-short-drama'),
    assetPromptPresetId: normalizePromptId(value.assetPromptPresetId, previous.assetPromptPresetId, 'asset', 'standard-asset-extraction'),
    injectCharacterPrompt: boolOr(value.injectCharacterPrompt, boolOr(previous.injectCharacterPrompt, true)),
    injectScenePrompt: boolOr(value.injectScenePrompt, boolOr(previous.injectScenePrompt, true)),
    injectPropPrompt: boolOr(value.injectPropPrompt, boolOr(previous.injectPropPrompt, true)),
    subtitlePolicy: value.subtitlePolicy === 'allow' ? 'allow' : (value.subtitlePolicy === 'forbid-auto-dialogue-subtitle' ? value.subtitlePolicy : (previous.subtitlePolicy || 'forbid-auto-dialogue-subtitle'))
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
    organizationId: text(value.organizationId ?? previous.organizationId, 160),
    configId: text(value.configId ?? previous.configId, 160)
  };
}

function bumpVideoRevision(video) {
  video.promptRevision = Math.max(1, Number(video.promptRevision || 1)) + 1;
}

function bumpAllVideoRevisions(item) {
  for (const video of item?.directorResult?.storyboard || []) bumpVideoRevision(video);
}

function invalidateDirector(item, reason = '导演级设置已修改，请重新导演。') {
  item.hookDraft = '';
  item.approvedHookScript = '';
  item.hookMeta = null;
  item.directorResult = null;
  item.directorSnapshot = null;
  item.promptVersions = {};
  item.videoPromptErrors = {};
  item.production = null;
  item.productionResults = [];
  item.productionSubmissionError = null;
  item.status = 'pending';
  item.error = '';
  item.staleReason = reason;
}

function changedKeys(before = {}, after = {}, keys = []) {
  return keys.filter(key => !same(before?.[key], after?.[key]));
}

function applySettingSideEffects(item, before, after, changed) {
  if (changed.some(key => DIRECTOR_SETTING_KEYS.has(key))) {
    invalidateDirector(item);
    return 'director';
  }
  if (changed.some(key => GENERATION_SETTING_KEYS.has(key)) && item.directorResult?.storyboard?.length) {
    bumpAllVideoRevisions(item);
    item.staleReason = '生成设置已修改，已有 VIDEO 成品基于旧 Prompt；请按需重新生成。';
    return 'generation';
  }
  return '';
}

function sanitizeBookOverride(input = {}, previous = {}) {
  const next = { ...(previous || {}) };
  for (const key of BOOK_OVERRIDE_KEYS) {
    if (!hasOwn(input, key)) continue;
    const value = input[key];
    if (value === null || value === 'inherit') {
      delete next[key];
      continue;
    }
    if (key === 'productionMode') next[key] = value === 'viral' ? 'viral' : 'original';
    else if (key === 'productionLineCount') next[key] = normalizeProductionLineCount(value);
    else if (key === 'hookReviewMode') next[key] = value === 'manual' ? 'manual' : 'auto';
    else if (key === 'scriptPromptPresetId') next[key] = normalizePromptId(value, '', 'script', 'standard-short-drama');
    else if (key === 'assetPromptPresetId') next[key] = normalizePromptId(value, '', 'asset', 'standard-asset-extraction');
    else if (['videoModelId', 'videoModelVersionId', 'videoModelMaxDuration', 'maxVideoDuration', 'exactDuration'].includes(key)) next[key] = Number(value);
    else if (key === 'fixedSingleVideo' || key.startsWith('inject')) next[key] = Boolean(value);
    else if (key === 'aspectRatio') next[key] = value === '16:9' ? '16:9' : '9:16';
    else if (key === 'subtitlePolicy') next[key] = value === 'allow' ? 'allow' : 'forbid-auto-dialogue-subtitle';
    else if (key === 'prefixMode') next[key] = value === 'manual' ? 'manual' : 'auto';
    else next[key] = text(value);
  }
  return next;
}

function sanitizeVideoOverride(input = {}, previous = {}) {
  const next = { ...(previous || {}) };
  for (const key of VIDEO_OVERRIDE_KEYS) {
    if (!hasOwn(input, key)) continue;
    const value = input[key];
    if (value === null || value === 'inherit') {
      delete next[key];
      continue;
    }
    if (key.startsWith('inject')) next[key] = Boolean(value);
    else if (key === 'aspectRatio') next[key] = value === '16:9' ? '16:9' : '9:16';
    else if (key === 'subtitlePolicy') next[key] = value === 'allow' ? 'allow' : 'forbid-auto-dialogue-subtitle';
    else if (key === 'prefixMode') next[key] = value === 'manual' ? 'manual' : 'auto';
    else next[key] = text(value);
  }
  return next;
}

function createBatchFactoryControlsRouter({ store = createBatchFactoryStore(), shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.put('/batches/:batchId/settings', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const beforeSettings = { productionMode: batch.mode || 'original', ...(batch.settings || {}) };
    const merged = { ...beforeSettings, ...input };
    try {
      const resolved = await resolveBoundVideoSettings(req, merged, shuihuoGateway);
      const normalized = store.normalizeSettings(resolved);
      const extras = normalizeProductionExtras(input, batch.settings || {});
      const afterSettings = { ...normalized, ...extras };
      const keys = [...new Set([...Object.keys(beforeSettings), ...Object.keys(afterSettings)])];
      const changed = changedKeys(beforeSettings, afterSettings, keys);
      store.updateBatch(req.username, batch.id, target => {
        target.settings = afterSettings;
        target.mode = afterSettings.productionMode;
        for (const item of target.items || []) {
          const inheritedChanges = changed.filter(key => !hasOwn(item.settingsOverride, key));
          if (!inheritedChanges.length) continue;
          const before = resolveItemSettings({ ...target, settings: beforeSettings }, item);
          const after = resolveItemSettings(target, item);
          applySettingSideEffects(item, before, after, inheritedChanges);
        }
      });
      return res.json({ batch: store.getBatch(req.username, batch.id), changed });
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

  // This edits only the video-production excerpt. The full txtText is immutable
  // here and remains the source uploaded later as ${bookId}.txt.
  router.put('/batches/:batchId/items/:itemId/source', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const clearOverride = req.body?.clearOverride === true;
    const productionText = text(req.body?.productionText ?? req.body?.sourceText, 120000);
    if (!clearOverride && !productionText) return res.status(400).json({ error: '视频制作内容不能为空' });
    store.updateItem(req.username, batch.id, item.id, target => {
      target.productionTextOverride = clearOverride ? '' : productionText;
      invalidateDirector(target, clearOverride ? '已恢复按制作行数取文，请重新导演。' : '视频制作内容已修改，请重新导演。');
      target.manuallyEdited = true;
    });
    store.appendItemActivity?.(req.username, batch.id, item.id, {
      type: 'source-edit',
      status: 'pending',
      message: clearOverride
        ? '已恢复按制作行数自动取文；完整 TXT 未修改。'
        : '视频制作内容已修改；完整 TXT 未修改，旧导演结果已失效。'
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.put('/batches/:batchId/items/:itemId/overrides', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const before = resolveItemSettings(batch, item);
    let next;
    try {
      next = sanitizeBookOverride(input, item.settingsOverride || {});
      if (hasOwn(input, 'videoModelId') && input.videoModelId !== null && input.videoModelId !== 'inherit') {
        const candidate = { ...before, ...next };
        const bound = await resolveBoundVideoSettings(req, candidate, shuihuoGateway);
        next.videoModelId = bound.videoModelId;
        next.videoModelVersionId = bound.videoModelVersionId;
        next.videoModelName = bound.videoModelName;
        next.videoModelMaxDuration = bound.videoModelMaxDuration;
        next.maxVideoDuration = bound.maxVideoDuration;
        if (bound.fixedSingleVideo) next.exactDuration = bound.exactDuration;
      }
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '保存当前小说设置失败' });
    }
    const fakeItem = { ...item, settingsOverride: next };
    const after = resolveItemSettings(batch, fakeItem);
    const changed = changedKeys(before, after, BOOK_OVERRIDE_KEYS);
    store.updateItem(req.username, batch.id, item.id, target => {
      target.settingsOverride = next;
      applySettingSideEffects(target, before, after, changed);
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id), changed });
  });

  router.put('/batches/:batchId/items/:itemId/videos/:videoId/overrides', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    const video = item?.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
    if (!batch || !item || !video) return res.status(404).json({ error: '批次、小说或 VIDEO 不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const before = resolveVideoSettings(batch, item, video);
    const next = sanitizeVideoOverride(input, video.settingsOverride || {});
    const after = resolveVideoSettings(batch, item, { ...video, settingsOverride: next });
    const changed = changedKeys(before, after, VIDEO_OVERRIDE_KEYS);
    store.updateItem(req.username, batch.id, item.id, target => {
      const targetVideo = target.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!targetVideo) return;
      targetVideo.settingsOverride = next;
      if (changed.length) {
        bumpVideoRevision(targetVideo);
        target.staleReason = `VIDEO ${targetVideo.id} 生成设置已修改，请重新生成该 VIDEO。`;
      }
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id), changed });
  });

  return router;
}

module.exports = {
  createBatchFactoryControlsRouter,
  normalizeProductionExtras,
  normalizePublishSettings,
  invalidateDirector,
  bumpVideoRevision,
  DIRECTOR_SETTING_KEYS,
  GENERATION_SETTING_KEYS
};
