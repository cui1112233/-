const express = require('express');
const { proxyV11Request } = require('../lib/batch-factory-v11/go-proxy');

function createGiantMaterialExecutorBridgeRouter(options = {}) {
  const router = express.Router();

  const forward = async (req, res, next) => {
    try {
      return await proxyV11Request(req, res, options);
    } catch (error) {
      if (res.headersSent) return next(error);
      return res.status(Number(error?.status) || 503).json({ error: '巨量素材执行器服务暂不可用' });
    }
  };

  router.get('/giant-material-executors', forward);
  router.post('/giant-material-executor/pairings', forward);
  router.post('/giant-material-jobs', forward);
  router.get('/giant-material-jobs/:id', forward);
  router.put('/giant-material-jobs/:id/cancel', forward);

  return router;
}

module.exports = { createGiantMaterialExecutorBridgeRouter };
