const express = require('express');
const { proxyV11Request } = require('../lib/batch-factory-v11/go-proxy');

function createBatchFactoryV11Router(options = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      return await proxyV11Request(req, res, options);
    } catch (error) {
      if (res.headersSent) return next(error);
      return res.status(502).json({ error: 'Batch Factory V11 Go service unavailable', code: 'BFV11_UPSTREAM_UNAVAILABLE' });
    }
  });
  return router;
}

module.exports = { createBatchFactoryV11Router };
