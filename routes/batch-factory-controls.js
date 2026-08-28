const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { resolveItemSettings } = require('../lib/batch-factory/effective-settings');
const { publicPromptCatalog } = require('../lib/batch-factory/prompt-selection');
const { resolveBoundVideoSettings } = require('./batch-factory');

// Kept for compatibility with older tests/importers. Runtime validation uses the
// live published Batch Factory prompt catalog so administrator-created presets
// are selectable without another code change.
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

function catalogIds(catalog, key) {
  return new Set((Array.isArray(catalog?.[key]) ? catalog[key] : []).map(item => String(item?.id || '')).filter(Boolean));
}

function normalizedPromptId(value, previous, allowedIds, fallback) {
  const requested = text(value, 160);
  if (requested && allowedIds.has(requested)) return requested;
  const previousId = text(previous, 160);
  if (previousId && allowedIds.has(previousId)) return previousId;
  if (allowedIds.has(fallback)) return fallback;
  return [...allowedIds][0] || fallback;
}

function normalizeProductionExtras(value = {}, previous = {}, catalog = publicPromptCatalog()) {
  const scriptIds = catalogIds(catalog, 'scriptPrompts');
  const assetIds = catalogIds(catalog, 'assetPrompts');
  return {
    scriptPromptPresetId: normalizedPromptId(value.scriptPromptPresetId, previous.scriptPromptPresetId, scriptIds, 'standard-short-drama'),
    assetPromptPresetId: normalizedPromptId(value.assetPromptPresetId, previous.assetPromptPresetId, assetIds, 'standard-asset-extraction'),
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

function invalidateDirectorState(item) {
  item.directorResult = null;
  item.promptVersions = {};
  item.videoPromptErrors = {};
  item.production = null;
  item.productionResults = [];
  item.productionSubmissionError = null;
  item.status = 'pending';
  item.error = '';
}

function invalidateItemAfterSourceEdit(item, sourceText, txtText) {
  item.sourceText = sourceText;
  item.txtText = txtText || sourceText;
  item.txtFileName = item.bookId ? `${item.bookId}.txt` : item.txtFileName;
  item.hookDraft = '';
  item.approvedHookScript = '';
  item.hookMeta = null;
  invalidateDirectorState(item);
  item.manuallyEdited = true;
}

function directorFingerprint(settings = {}) {
  return JSON.stringify({
    scriptPromptPresetId: settings.scriptPromptPresetId || '',
    assetPromptPresetId: settings.assetPromptPresetId || '',
    aspectRatio: settings.aspectRatio || '9:16',
    fixedSingleVideo: settings.fixedSingleVideo === true,
    exactDuration: settings.exactDuration || null,
    maxVideoDuration: settings.maxVideoDuration || null,
    style: settings.style || '',
    synopsis: settings.synopsis || ''
  });
}

function directorSettingsChanged(before, after) {
  return directorFingerprint(before) !== directorFingerprint(after);
}

function normalizeItemOverrides(input = {}, previous = {}, catalog = publicPromptCatalog()) {
  const scriptIds = catalogIds(catalog, 'scriptPrompts');
  const assetIds = catalogIds(catalog, 'assetPrompts');
  const requestedScript = text(input.scriptPromptPresetId, 160);
  const requestedAsset = text(input.assetPromptPresetId, 160);
  return {
    scriptPromptPresetId: requestedScript === 'inherit' || requestedScript === ''
      ? ''
      : (scriptIds.has(requestedScript) ? requestedScript : text(previous.scriptPromptPresetId, 160)),
    assetPromptPresetId: requestedAsset === 'inherit' || requestedAsset === ''
      ? ''
      : (assetIds.has(requestedAsset) ? requestedAsset : text(previous.assetPromptPresetId, 160)),
    aspectRatio: ['inherit', '9:16', '16:9'].includes(input.aspectRatio) ? input.aspectRatio : (previous.aspectRatio || 'inherit'),
    fixedSingleVideo: input.fixedSingleVideo === 'inherit'
      ? 'inherit'
      : (typeof input.fixedSingleVideo === 'boolean' ? input.fixedSingleVideo : (previous.fixedSingleVideo ?? 'inherit')),
    prefixMode: ['inherit', 'auto', 'manual'].includes(input.prefixMode) ? input.prefixMode : (previous.prefixMode || 'inherit'),
    customPrefix: text(input.customPrefix ?? previous.customPrefix),
    style: text(input.style ?? previous.style),
    synopsis: text(input.synopsis ?? previous.synopsis),
    quality: text(input.quality ?? previous.quality),
    restriction: text(input.restriction ?? previous.restriction),
    negative: text(input.negative ?? previous.negative),
    injectCharacterPrompt: input.injectCharacterPrompt === 'inherit'
      ? 'inherit'
      : (typeof input.injectCharacterPrompt === 'boolean' ? input.injectCharacterPrompt : (previous.injectCharacterPrompt ?? 'inherit')),
    injectScenePrompt: input.injectScenePrompt === 'inherit'
      ? 'inherit'
      : (typeof input.injectScenePrompt === 'boolean' ? input.injectScenePrompt : (previous.injectScenePrompt ?? 'inherit')),
    injectPropPrompt: input.injectPropPrompt === 'inherit'
      ? 'inherit'
      : (typeof input.injectPropPrompt === 'boolean' ? input.injectPropPrompt : (previous.injectPropPrompt ?? 'inherit')),
    subtitlePolicy: ['inherit', 'allow', 'forbid-auto-dialogue-subtitle'].includes(input.subtitlePolicy)
      ? input.subtitlePolicy
      : (previous.subtitlePolicy || 'inherit')
  };
}

function effectiveSettingsFor(batch, item, override) {
  return resolveItemSettings(batch, { ...item, settingsOverride: override });
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
      const nextSettings = { ...normalized, ...extras };
      const beforeBatch = { ...batch, settings: { ...(batch.settings || {}) } };
      const afterBatch = { ...batch, settings: nextSettings };
      const impacted = (batch.items || []).filter(item => directorSettingsChanged(resolveItemSettings(beforeBatch, item), resolveItemSettings(afterBatch, item)));
      if (impacted.some(item => item.production?.projectId)) {
        return res.status(409).json({ error: '已有小说进入视频生产，不能再修改会改变导演拆分的统一设置。请新建批次或仅调整前缀/画质/限制/负面词。' });
      }
      store.updateBatch(req.username, batch.id, target => {
        target.settings = nextSettings;
        for (const item of target.items || []) {
          const before = resolveItemSettings(beforeBatch, item);
          const after = resolveItemSettings({ ...target, settings: nextSettings }, item);
          if (directorSettingsChanged(before, after) && item.directorResult) invalidateDirectorState(item);
        }
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
    const next = normalizeItemOverrides(input, previous);
    const beforeEffective = effectiveSettingsFor(batch, item, previous);
    const afterEffective = effectiveSettingsFor(batch, item, next);
    const needsRedirect = directorSettingsChanged(beforeEffective, afterEffective);
    if (needsRedirect && item.production?.projectId) {
      return res.status(409).json({ error: '当前小说已经进入视频生产，不能再修改剧本提示词、人物场景提示词、画幅或 VIDEO 时长策略。可以继续调整生成附加项，或新建批次后重新导演。' });
    }
    store.updateItem(req.username, batch.id, item.id, target => {
      target.settingsOverride = next;
      target.manuallyEdited = true;
      if (needsRedirect && target.directorResult) invalidateDirectorState(target);
    });
    store.appendItemActivity?.(req.username, batch.id, item.id, {
      type: 'settings-override',
      status: needsRedirect ? 'pending' : item.status,
      message: needsRedirect
        ? '当前小说的导演级设置已修改，旧导演结果已失效；请重新导演当前小说。'
        : '当前小说已保存单独生成设置。'
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.delete('/batches/:batchId/items/:itemId/overrides', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const beforeEffective = resolveItemSettings(batch, item);
    const afterEffective = effectiveSettingsFor(batch, item, {});
    const needsRedirect = directorSettingsChanged(beforeEffective, afterEffective);
    if (needsRedirect && item.production?.projectId) {
      return res.status(409).json({ error: '当前小说已经进入视频生产，无法恢复会改变导演拆分的统一设置。' });
    }
    store.updateItem(req.username, batch.id, item.id, target => {
      target.settingsOverride = {};
      target.manuallyEdited = true;
      if (needsRedirect && target.directorResult) invalidateDirectorState(target);
    });
    store.appendItemActivity?.(req.username, batch.id, item.id, {
      type: 'settings-restore',
      status: needsRedirect ? 'pending' : item.status,
      message: needsRedirect ? '已恢复批次统一设置，旧导演结果已失效。' : '已恢复批次统一生成设置。'
    });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  return router;
}

module.exports = {
  createBatchFactoryControlsRouter,
  normalizeProductionExtras,
  normalizePublishSettings,
  normalizeItemOverrides,
  directorFingerprint,
  SCRIPT_PROMPT_PRESETS,
  ASSET_PROMPT_PRESETS
};