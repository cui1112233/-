const http = require('node:http');
const https = require('node:https');

const PREFIX = '/api/local-executor/v1/';

function buildForwardRequest(req, targetBaseUrl) {
  const originalUrl = req.originalUrl || req.url || '';
  const parsed = new URL(originalUrl, 'http://qiantie.local');
  if (req.method !== 'POST' || !parsed.pathname.startsWith(PREFIX)) {
    const error = new Error('local executor device path not allowed');
    error.status = 404;
    throw error;
  }
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const body = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const headers = { Accept: req.headers?.accept || 'application/json' };
  if (req.headers?.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers?.['x-request-id']) headers['X-Request-ID'] = req.headers['x-request-id'];
  headers['Content-Type'] = req.headers?.['content-type'] || 'application/json';
  headers['Content-Length'] = String(body.length);
  return {
    target,
    transport: target.protocol === 'https:' ? https : http,
    options: {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: 'POST',
      path: parsed.pathname + parsed.search,
      headers,
      timeout: 20000
    },
    body
  };
}

module.exports = { PREFIX, buildForwardRequest };
