const express = require('express');
const { proxyV11Request } = require('../lib/batch-factory-v11/go-proxy');

function createLocalExecutorArtifactRouter(options = {}) {
  const router = express.Router();
  router.get('/:id', async (req, res, next) => {
    const id = String(req.params.id || '').trim();
    if (!id || /[\\\\/]/.test(id)) {
      return res.status(400).json({ error: 'invalid artifact id' });
    }
    try {
      return await proxyV11Request(req, res, options);
    } catch (error) {
      if (res.headersSent) return next(error);
      return res.status(Number(error?.status) || 503).json({ error: '本地执行器成品暂不可用' });
    }
  });
  return router;
}

module.exports = { createLocalExecutorArtifactRouter };
