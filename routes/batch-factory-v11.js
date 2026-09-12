const express = require('express');
const { getVideoApiKey, readConfig } = require('../lib/shared');
const { resolveRuntimeModel } = require('../lib/model-catalog-runtime');
const { proxyV11Request, createSignedBridgeHeaders } = require('../lib/batch-factory-v11/go-proxy');

const PERSONAL_PROVIDER = 'personal_api';
const LOCAL_PROVIDER = 'doubao_local_executor';
const H3_PROVIDER = 'autodl_comfyui';
const PERSONAL_MODEL = 'yd2.0-mini';
const H3_MODEL = 'minimax-h3-video';
const H3_CREATE_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/{workflow}';
const H3_TASKS_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/result/{id}';
const CONFIG_PATH = '/api/batch-factory/v11/video-provider/config';
const STATUS_PATH = '/api/batch-factory/v11/video-provider/status';

function normalizedProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider || ['personal', 'personal_api', 'yd_video', 'yadi'].includes(provider)) return PERSONAL_PROVIDER;
  if (['doubao', 'doubao_local', 'doubao_local_executor'].includes(provider)) return LOCAL_PROVIDER;
  if (['h3', 'minimax_h3', 'minimax-h3-video', 'autodl', 'autodl_comfyui', 'autodl_comfyui_video'].includes(provider)) return H3_PROVIDER;
  return provider;
}

function isProductionPath(pathname) {
  return /\\/batches\\/[^/]+(?:\\/books\\/[^/]+)?\\/production$/.test(pathname);
}

function providerFromRequest(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return normalizedProvider(req.body.provider);
  }
  const parsed = new URL(req.originalUrl || req.url, 'http://qiantie.local');
  return normalizedProvider(parsed.searchParams.get('provider'));
}

function isProviderConfigPath(pathname) {
  return pathname === CONFIG_PATH;
}

function needsPersonalConfigSync(req, pathname) {
  if (isProviderConfigPath(pathname)) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  if (req.method === 'POST' && /\/batches\/[^/]+(?:\/books\/[^/]+)?\/production$/.test(pathname)) return true;
  if (req.method === 'GET' && /\/batches\/[^/]+\/status$/.test(pathname)) return true;
  return false;
}

function needsH3ConfigSync(req, pathname) {
  if (pathname === CONFIG_PATH) return true;
  if (req.method === 'GET' && pathname === STATUS_PATH) return true;
  if (req.method === 'POST' && /\/batches\/[^/]+(?:\/books\/[^/]+)?\/production$/.test(pathname)) return true;
  if (req.method === 'GET' && /\/batches\/[^/]+\/status$/.test(pathname)) return true;
  return false;
}

function personalApiKeyForUser(req) {
  const config = readConfig(req.username);
  return req.v11RuntimeModel?.credential || getVideoApiKey(config, 'yd');
}

async function syncPersonalProviderConfig(req, options, { allowMissing = false } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const base = String(options.goBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://backend:4000').replace(/\/$/, '');
  const secret = options.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const apiKey = personalApiKeyForUser(req);
  if (!apiKey) {
    if (allowMissing) return false;
    const error = new Error('请先在个人中心配置视频 API Key');
    error.status = 400;
    error.code = 'VIDEO_API_KEY_REQUIRED';
    throw error;
  }
  const headers = {
    ...createSignedBridgeHeaders({
      username: req.username,
      isOwner: req.auth?.account?.isOwner === true,
      method: 'PUT',
      pathname: CONFIG_PATH,
      secret,
      now: (options.now || Date.now)()
    }),
    'Content-Type': 'application/json'
  };
  const response = await fetchImpl(base + CONFIG_PATH, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      provider: PERSONAL_PROVIDER,
      model: options.runtimeModel?.modelId || PERSONAL_MODEL,
      apiKey,
      ...(options.runtimeModel?.baseUrl ? { createUrl: options.runtimeModel.baseUrl } : {})
    }),
    redirect: 'manual'
  });
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error('个人中心视频 API 配置同步失败');
    error.status = response?.status === 401 ? 401 : 503;
    error.code = 'VIDEO_PROVIDER_SYNC_FAILED';
    throw error;
  }
  return true;
}

function h3ApiKeyForRequest(req, configReader = readConfig) {
  const personalKey = req.v11RuntimeModel?.credential || getVideoApiKey(configReader(req.username), 'h3');
  return personalKey || String(process.env.QIANTIE_AUTODL_H3_API_KEY || process.env.QIANTIE_H3_API_KEY || '').trim();
}

async function syncH3ProviderConfig(req, options, { allowMissing = false } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const apiKey = h3ApiKeyForRequest(req, options.configReader);
  if (!apiKey) {
    if (allowMissing) return false;
    const error = new Error('服务端尚未配置 AutoDL H3 API Key');
    error.status = 400;
    error.code = 'H3_API_KEY_REQUIRED';
    throw error;
  }
  const base = String(options.goBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://backend:4000').replace(/\/$/, '');
  const secret = options.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const headers = {
    ...createSignedBridgeHeaders({
      username: req.username,
      isOwner: req.auth?.account?.isOwner === true,
      method: 'PUT',
      pathname: CONFIG_PATH,
      secret,
      now: (options.now || Date.now)()
    }),
    'Content-Type': 'application/json'
  };
  const response = await fetchImpl(base + CONFIG_PATH, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ provider: H3_PROVIDER, model: options.runtimeModel?.modelId || H3_MODEL, apiKey, createUrl: options.runtimeModel?.baseUrl || H3_CREATE_URL, tasksUrl: H3_TASKS_URL }),
    redirect: 'manual'
  });
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error('AutoDL H3 视频配置同步失败');
    error.status = response?.status === 401 ? 401 : 503;
    error.code = 'H3_PROVIDER_SYNC_FAILED';
    throw error;
  }
  return true;
}

async function prepareProviderRequest(req, options, pathname) {
  if (/\\/batches\\/[^/]+(?:\\/books\\/[^/]+)?\\/(?:hook|director)$/.test(pathname) && req.body?.textModelId) {
    req.v11TextRuntimeModel = resolveRuntimeModel({
      username: req.username,
      kind: 'text',
      modelId: req.body.textModelId,
      memberStore: options.memberStore,
      configReader: options.configReader || readConfig
    });
  }
  if (isProductionPath(pathname) && req.body?.videoModelId) {
    const runtimeModel = resolveRuntimeModel({
      username: req.username,
      kind: 'video',
      modelId: req.body.videoModelId,
      memberStore: options.memberStore,
      configReader: options.configReader || readConfig
    });
    req.v11RuntimeModel = runtimeModel;
    const adapterProvider = runtimeModel.adapterKind === 'local_executor_video'
      ? LOCAL_PROVIDER
      : runtimeModel.adapterKind === 'autodl_comfyui_video'
        ? H3_PROVIDER
        : PERSONAL_PROVIDER;
    req.body = { ...req.body, provider: adapterProvider, model: runtimeModel.modelId || runtimeModel.id };
  }
  const provider = providerFromRequest(req);
  if (provider === LOCAL_PROVIDER) return;
  if (provider === H3_PROVIDER) {
    if (!needsH3ConfigSync(req, pathname)) return;
    const allowMissing = req.method === 'GET' && pathname !== CONFIG_PATH;
    if (pathname === CONFIG_PATH) {
      const apiKey = h3ApiKeyForRequest(req, options.configReader);
      if (!apiKey) {
        const error = new Error('服务端尚未配置 AutoDL H3 API Key');
        error.status = 400;
        error.code = 'H3_API_KEY_REQUIRED';
        throw error;
      }
      req.body = {
        ...(req.body || {}),
        provider: H3_PROVIDER,
        model: req.body?.model || H3_MODEL,
        apiKey,
        createUrl: req.body?.createUrl || H3_CREATE_URL,
        tasksUrl: req.body?.tasksUrl || H3_TASKS_URL
      };
      return;
    }
    await syncH3ProviderConfig(req, { ...options, runtimeModel: req.v11RuntimeModel }, { allowMissing });
    return;
  }
  if (!needsPersonalConfigSync(req, pathname)) return;
  const allowMissing = req.method === 'GET' || isProviderConfigPath(pathname) === false && req.method !== 'POST';
  if (isProviderConfigPath(pathname)) {
    // The browser never sends the secret directly. Inject the personal-center
    // key only on the trusted Node -> Go hop, and never echo it to the client.
    if (provider === PERSONAL_PROVIDER) {
      const apiKey = personalApiKeyForUser(req);
      if (!apiKey) {
        const error = new Error('请先在个人中心配置视频 API Key');
        error.status = 400;
        error.code = 'VIDEO_API_KEY_REQUIRED';
        throw error;
      }
      req.body = { ...(req.body || {}), provider: PERSONAL_PROVIDER, model: req.body?.model || PERSONAL_MODEL, apiKey };
    } else if (req.body && typeof req.body === 'object') {
      req.body = { ...req.body, provider: LOCAL_PROVIDER, apiKey: '' };
    }
    return;
  }
  await syncPersonalProviderConfig(req, { ...options, runtimeModel: req.v11RuntimeModel }, { allowMissing });
}

function createBatchFactoryV11Router(options = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      const parsed = new URL(req.originalUrl || req.url, 'http://qiantie.local');
      await prepareProviderRequest(req, options, parsed.pathname);
      return await proxyV11Request(req, res, options);
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = Number.isInteger(error?.status) ? error.status : 502;
      const code = error?.code || 'BFV11_UPSTREAM_UNAVAILABLE';
      const message = status === 400 ? error.message : 'Batch Factory V11 Go service unavailable';
      return res.status(status).json({ error: message, code });
    }
  });
  return router;
}

module.exports = {
  H3_PROVIDER,
  PERSONAL_PROVIDER,
  LOCAL_PROVIDER,
  h3ApiKeyForRequest,
  normalizedProvider,
  needsH3ConfigSync,
  needsPersonalConfigSync,
  createBatchFactoryV11Router
};
