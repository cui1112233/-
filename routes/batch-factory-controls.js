const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');
const { clearPersistedSettingsStateCache } = require('../lib/batch-factory/settings-state-bridge');

function text(value, max = 50000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
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

function invalidateItemAfterVideoModelChange(item) {
  // Hook review is independent from the selected video model. Preserve the
  // accepted viral opening and book-level overrides, but invalidate every
  // artifact derived from the old director VIDEO plan.
  item.directorResult = null;
  item.videoSettingsOverrides = {};
  item.promptVersions = {};
  item.videoPromptErrors = {};
  item.production = null;
  item.productionResults = [];
  item.productionSubmissionError = null;
  item.status = 'pending';
  item.error = '';
}

async function settingsPayloadWithGo(req, shuihuoGateway, pathname, body, method = 'PUT') {
  const upstream = await requestProductionBridge({
    username: req.auth.account.username,
    isOwner: req.auth.account.isOwner === true,
    pathname,
    body,
    method,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const error = new Error(upstream.payload?.error || 'Go 设置服务返回错误');
    error.statusCode = upstream.statusCode;
    throw error;
  }
  const payload = upstream.payload;
  const settings = payload?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    const error = new Error('Go 设置服务返回无效结果');
    error.statusCode = 502;
    throw error;
  }
  return payload;
}

async function settingsRequestWithGo(req, shuihuoGateway, pathname, body, method = 'PUT') {
  return (await settingsPayloadWithGo(req, shuihuoGateway, pathname, body, method)).settings;
}

function cloneItemWithOverride(item, settingsOverride) {
  return { ...item, settingsOverride };
}

function cloneItemWithVideoOverride(item, videoId, next) {
  const videoSettingsOverrides = { ...(item.videoSettingsOverrides || {}) };
  const key = String(videoId);
  if (Object.keys(next).length) videoSettingsOverrides[key] = next;
  else delete videoSettingsOverrides[key];
  return { ...item, videoSettingsOverrides };
}

function createBatchFactoryControlsRouter({
  store = createBatchFactoryStore(),
  shuihuoGateway,
  authenticate = apiAuth,
  persistSettings,
  persistOverride
} = {}) {
  const router = express.Router();
  router.use(authenticate);

  const persistSettingsRequest = persistSettings || ((payload, req, batchId) => settingsPayloadWithGo(
    req,
    shuihuoGateway,
    `/api/shuihuo-production/batch-factory/batches/${encodeURIComponent(batchId)}/settings`,
    payload,
    'PUT'
  ));
  const persistOverrideRequest = persistOverride || ((payload, req, scope) => {
    const itemPath = `/api/shuihuo-production/batch-factory/batches/${encodeURIComponent(scope.batchId)}/items/${encodeURIComponent(scope.itemId)}`;
    const pathname = scope.videoId === undefined
      ? `${itemPath}/overrides`
      : `${itemPath}/videos/${encodeURIComponent(scope.videoId)}/overrides`;
    return settingsRequestWithGo(req, shuihuoGateway, pathname, payload, 'PUT');
  });

  router.put('/batches/:batchId/settings', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
    const previous = batch.settings || {};
    try {
      const persisted = await persistSettingsRequest({ settings: input, previous }, req, batch.id);
      const envelope = persisted && typeof persisted === 'object' && !Array.isArray(persisted)
        && persisted.settings && typeof persisted.settings === 'object' && !Array.isArray(persisted.settings)
        ? persisted
        : null;
      const settings = envelope ? envelope.settings : persisted;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        const error = new Error('Go 设置服务返回无效结果');
        error.statusCode = 502;
        throw error;
      }

      if (envelope?.directorRegenerationRequired === true) {
        for (const item of Array.isArray(batch.items) ? batch.items : []) {
          store.updateItem(req.username, batch.id, item.id, target => {
            invalidateItemAfterVideoModelChange(target);
            return target;
          });
        }
      }

      clearPersistedSettingsStateCache(req.auth.account.username, batch.id);
      const currentBatch = envelope?.directorRegenerationRequired === true
        ? (store.getBatch(req.username, batch.id) || batch)
        : batch;
      return res.json({ batch: { ...currentBatch, settings } });
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

  router.put('/batches/:batchId/items/:itemId/overrides', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const inheritKeys = Array.isArray(req.body?.inheritKeys) ? req.body.inheritKeys : [];
    try {
      const next = await persistOverrideRequest({
        settings: input,
        previous: item.settingsOverride || {},
        inheritKeys
      }, req, { batchId: batch.id, itemId: item.id });
      clearPersistedSettingsStateCache(req.auth.account.username, batch.id);
      return res.json({ item: cloneItemWithOverride(item, next) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '保存当前小说设置失败' });
    }
  });

  router.put('/batches/:batchId/items/:itemId/videos/:videoId/overrides', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    const video = item?.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    if (!video) return res.status(404).json({ error: 'VIDEO 分镜不存在' });
    const input = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const inheritKeys = Array.isArray(req.body?.inheritKeys) ? req.body.inheritKeys : [];
    const previous = item.videoSettingsOverrides?.[String(video.id)] || {};
    try {
      const next = await persistOverrideRequest({ settings: input, previous, inheritKeys }, req, {
        batchId: batch.id,
        itemId: item.id,
        videoId: String(video.id)
      });
      clearPersistedSettingsStateCache(req.auth.account.username, batch.id);
      return res.json({ item: cloneItemWithVideoOverride(item, video.id, next) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '保存 VIDEO 设置失败' });
    }
  });

  return router;
}

module.exports = {
  createBatchFactoryControlsRouter,
  normalizePublishSettings,
  settingsPayloadWithGo,
  settingsRequestWithGo
};
