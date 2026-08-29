const express = require('express');
const { apiAuth } = require('../middleware/auth');
const {
  loadPersistedSettingsState,
  bootstrapPersistedSettingsState
} = require('../lib/batch-factory/settings-state-bridge');

function batchIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/batches\/([^/]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasKeys(value) {
  return Object.keys(objectOrEmpty(value)).length > 0;
}

function legacySettingsState(batch) {
  const itemOverrides = {};
  const videoOverrides = {};
  for (const item of Array.isArray(batch?.items) ? batch.items : []) {
    const itemOverride = objectOrEmpty(item?.settingsOverride);
    if (hasKeys(itemOverride)) itemOverrides[item.id] = itemOverride;

    const videos = objectOrEmpty(item?.videoSettingsOverrides);
    const migratedVideos = {};
    for (const [videoId, override] of Object.entries(videos)) {
      const normalized = objectOrEmpty(override);
      if (hasKeys(normalized)) migratedVideos[String(videoId)] = normalized;
    }
    if (hasKeys(migratedVideos)) videoOverrides[item.id] = migratedVideos;
  }
  return {
    settings: objectOrEmpty(batch?.settings),
    itemOverrides,
    videoOverrides
  };
}

function createBatchFactorySettingsHydrationRouter({
  shuihuoGateway,
  authenticate = apiAuth,
  store,
  loadState = loadPersistedSettingsState,
  bootstrapState = bootstrapPersistedSettingsState
} = {}) {
  const router = express.Router();
  router.use(authenticate);
  router.use(async (req, res, next) => {
    const batchId = batchIdFromPath(req.path);
    if (!batchId) return next();
    try {
      const loaded = await loadState({
        username: req.auth.account.username,
        isOwner: req.auth.account.isOwner === true,
        batchId,
        shuihuoGateway
      });
      if (loaded?.persisted !== true && store?.getBatch) {
        const legacyBatch = store.getBatch(req.username, batchId);
        if (legacyBatch) {
          await bootstrapState({
            username: req.auth.account.username,
            isOwner: req.auth.account.isOwner === true,
            batchId,
            state: legacySettingsState(legacyBatch),
            shuihuoGateway
          });
        }
      }
      return next();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || '读取生产设置失败' });
    }
  });
  return router;
}

module.exports = {
  createBatchFactorySettingsHydrationRouter,
  batchIdFromPath,
  legacySettingsState
};
