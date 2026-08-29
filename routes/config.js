const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, DEFAULT_CONFIG } = require('../lib/shared');
const { signBridgeRequest } = require('./shuihuo-production');

function normalizeTtsConfig(value, fallback = {}) {
  const voice = typeof value?.voice === 'string' && value.voice.startsWith('zh-CN-')
    ? value.voice
    : fallback.voice || 'zh-CN-XiaoxiaoNeural';
  const style = ['general', 'cheerful', 'sad', 'friendly', 'chat'].includes(value?.style)
    ? value.style
    : fallback.style || 'general';
  const speed = Number(value?.speed);
  const pitch = Number(value?.pitch);
  return {
    voice,
    style,
    speed: Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : (fallback.speed ?? 1.8),
    pitch: Number.isFinite(pitch) ? Math.min(50, Math.max(-50, pitch)) : (fallback.pitch ?? 10)
  };
}

function requestedPetID(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' ? id.trim() : '';
}

function requestGoConfig({ targetBaseUrl, bridgeSecret } = {}, account, { method = 'GET', body } = {}) {
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;
  const pathname = '/api/platform/config';
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const username = account?.username || '';
  const isOwner = account?.isOwner === true;
  const signature = signBridgeRequest(secret, { username, isOwner, issuedAt, method, pathname });
  const requestBody = ['GET', 'HEAD'].includes(method) ? null : Buffer.from(JSON.stringify(body ?? {}));
  const headers = {
    Accept: 'application/json',
    'X-Qiantie-Username': username,
    'X-Qiantie-Is-Owner': String(isOwner),
    'X-Qiantie-Issued-At': issuedAt,
    'X-Qiantie-Signature': signature
  };
  if (requestBody) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(requestBody.length);
  }

  return new Promise((resolve, reject) => {
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: pathname,
      headers,
      timeout: 15_000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch (_) {
          const error = new Error('Go 配置服务返回了无效响应');
          error.status = 502;
          reject(error);
          return;
        }
        const status = response.statusCode || 502;
        if (status >= 400) {
          const error = new Error(payload.error || `Go 配置服务返回 ${status}`);
          error.status = status;
          error.payload = payload;
          reject(error);
          return;
        }
        resolve(payload);
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Go 配置服务响应超时')));
    upstream.on('error', reject);
    if (requestBody) upstream.write(requestBody);
    upstream.end();
  });
}

function createConfigRouter({ gateway = {}, requestConfig = requestGoConfig } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  // GET /api/config — Node keeps legacy model/TTS fields, pet_id is read from Go.
  router.get('/', async (req, res) => {
    try {
      const goConfig = await requestConfig(gateway, req.auth.account, { method: 'GET' });
      const config = readConfig(req.username);
      config.tts = normalizeTtsConfig(config.tts);
      res.json(publicConfig({ ...config, pet: goConfig.pet || 'stacky' }));
    } catch (error) {
      res.status(error.status || 503).json(error.payload || { error: error.message || 'Go 配置服务暂不可用' });
    }
  });

  // POST /api/config — pet is never persisted in Node; Go owns the account preference.
  router.post('/', async (req, res) => {
    const body = req.body || {};
    const oldConfig = readConfig(req.username);
    const petID = requestedPetID(body.pet);
    try {
      const goConfig = await requestConfig(gateway, req.auth.account, {
        method: 'POST',
        body: petID ? { pet: petID } : {}
      });
      const nextConfig = {
        provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
        baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
        model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
        apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
        tts: normalizeTtsConfig(body.tts, oldConfig.tts)
      };
      writeConfig(req.username, nextConfig);
      res.json(publicConfig({ ...nextConfig, pet: goConfig.pet || 'stacky' }));
    } catch (error) {
      res.status(error.status || 503).json(error.payload || { error: error.message || 'Go 配置服务暂不可用' });
    }
  });

  return router;
}

const defaultRouter = createConfigRouter();
module.exports = defaultRouter;
module.exports.createConfigRouter = createConfigRouter;
module.exports.requestGoConfig = requestGoConfig;
module.exports.requestedPetID = requestedPetID;
