const http = require('node:http');
const https = require('node:https');

const PREFIX = '/api/local-executor/v1/';
const ARTIFACT_PATH = /^\/api\/local-executor\/v1\/jobs\/[^/]+\/artifact$/;

function buildForwardRequest(req, targetBaseUrl) {
  const originalUrl = req.originalUrl || req.url || '';
  const parsed = new URL(originalUrl, 'http://qiantie.local');
  if (req.method !== 'POST' || !parsed.pathname.startsWith(PREFIX)) {
    const error = new Error('local executor device path not allowed');
    error.status = 404;
    throw error;
  }

  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const streamBody = ARTIFACT_PATH.test(parsed.pathname) && isMp4(req.headers?.['content-type']);
  const body = streamBody
    ? null
    : Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

  const headers = { Accept: req.headers?.accept || 'application/json' };
  copyHeader(req, headers, 'authorization', 'Authorization');
  copyHeader(req, headers, 'x-request-id', 'X-Request-ID');
  copyHeader(req, headers, 'x-lease-token', 'X-Lease-Token');
  copyHeader(req, headers, 'x-lease-generation', 'X-Lease-Generation');
  headers['Content-Type'] = req.headers?.['content-type'] || 'application/json';

  if (streamBody) {
    if (req.headers?.['content-length']) headers['Content-Length'] = String(req.headers['content-length']);
  } else {
    headers['Content-Length'] = String(body.length);
  }

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
    body,
    streamBody
  };
}

function copyHeader(req, headers, source, target) {
  const value = req.headers?.[source];
  if (value !== undefined && value !== null && value !== '') headers[target] = String(value);
}

function isMp4(contentType) {
  return String(contentType || '').split(';', 1)[0].trim().toLowerCase() === 'video/mp4';
}

module.exports = { PREFIX, ARTIFACT_PATH, buildForwardRequest, isMp4 };
