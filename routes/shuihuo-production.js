const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { apiAuth } = require('../middleware/auth');

const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

function signBridgeRequest(secret, { username, isOwner, issuedAt, method, pathname }) {
  const payload = [username, issuedAt, String(isOwner), method, pathname].join('\n');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createShuihuoProductionRouter({ targetBaseUrl, bridgeSecret } = {}) {
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;
  const router = express.Router();

  router.use(apiAuth);
  router.use((req, res) => {
    const requestURL = new URL(req.originalUrl, 'http://qiantie-gateway.local');
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const username = req.auth.account.username;
    const isOwner = req.auth.account.isOwner === true;
    const signature = signBridgeRequest(secret, { username, isOwner, issuedAt, method: req.method, pathname: requestURL.pathname });
    const body = ['GET', 'HEAD'].includes(req.method) ? null : Buffer.from(JSON.stringify(req.body ?? {}));
    const headers = {
      'X-Qiantie-Username': username,
      'X-Qiantie-Is-Owner': String(isOwner),
      'X-Qiantie-Issued-At': issuedAt,
      'X-Qiantie-Signature': signature,
      Accept: req.get('accept') || 'application/json'
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(body.length);
    }

    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path: requestURL.pathname + requestURL.search,
      headers,
      timeout: 15_000
    }, upstreamResponse => {
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
      }
      res.status(upstreamResponse.statusCode || 502);
      upstreamResponse.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy(new Error('水货生产服务响应超时')));
    upstream.on('error', error => {
      if (res.headersSent) return res.destroy(error);
      res.status(503).json({ error: '水货生产服务暂不可用，请稍后重试' });
    });
    if (body) upstream.write(body);
    upstream.end();
  });

  return router;
}

module.exports = { createShuihuoProductionRouter, signBridgeRequest };
