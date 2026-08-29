const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { loadPersistedSettingsState } = require('../lib/batch-factory/settings-state-bridge');

function batchIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/batches\/([^/]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

function createBatchFactorySettingsHydrationRouter({ shuihuoGateway, authenticate = apiAuth, loadState = loadPersistedSettingsState } = {}) {
  const router = express.Router();
  router.use(authenticate);
  router.use(async (req, res, next) => {
    const batchId = batchIdFromPath(req.path);
    if (!batchId) return next();
    try {
      await loadState({
        username: req.auth.account.username,
        isOwner: req.auth.account.isOwner === true,
        batchId,
        shuihuoGateway
      });
      return next();
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || '读取生产设置失败' });
    }
  });
  return router;
}

module.exports = { createBatchFactorySettingsHydrationRouter, batchIdFromPath };
