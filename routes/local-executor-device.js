const express = require('express');
const { buildForwardRequest } = require('../lib/local-executor-device-forwarder');

function createLocalExecutorDeviceRouter({ targetBaseUrl } = {}) {
  const router = express.Router();

  router.use((req, res) => {
    let built;
    try {
      built = buildForwardRequest(req, targetBaseUrl);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || 'invalid local executor request' });
    }

    const upstream = built.transport.request(built.options, upstreamResponse => {
      const contentType = upstreamResponse.headers['content-type'];
      const requestId = upstreamResponse.headers['x-request-id'];
      if (contentType) res.setHeader('Content-Type', contentType);
      if (requestId) res.setHeader('X-Request-ID', requestId);
      res.status(upstreamResponse.statusCode || 502);
      upstreamResponse.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy(new Error('local executor service timeout')));
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      return res.status(503).json({ error: '本地执行器服务暂不可用' });
    });
    upstream.end(built.body);
  });

  return router;
}

module.exports = { createLocalExecutorDeviceRouter };
