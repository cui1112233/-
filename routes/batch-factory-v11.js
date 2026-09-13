const express = require('express');
const { getVideoApiKey, readConfig } = require('../lib/shared');
const { proxyV11Request, createSignedBridgeHeaders } = require('../lib/batch-factory-v11/go-proxy');
const { BATCH_FACTORY_PRESET_REQUIREMENTS, isPublishedPresetAllowed, resolveSystemPresetBody } = require('../lib/system-preset-catalog');

const PERSONAL_PROVIDER = 'personal_api';
const LOCAL_PROVIDER = 'doubao_local_executor';
const H3_PROVIDER = 'autodl_comfyui';
const PERSONAL_MODEL = 'yd2.0-mini';
const H3_MODEL = 'minimax-h3-video';
const H3_CREATE_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/{workflow}';
const H3_TASKS_URL = 'https://autodl.art/api/v1/comfyui/comfyui_workflow/result/{id}';
const CONFIG_PATH = '/api/batch-factory/v11/video-provider/config';
const STATUS_PATH = '/api/batch-factory/v11/video-provider/status';
const AI_PROMPT_MODULES = ['assets', 'constraints', 'video', 'visual'];

function resolveV11GoBaseUrl(env = process.env) {
  return String(env.QIANTIE_BATCH_FACTORY_V11_BASE_URL || env.QIANTIE_GO_BASE_URL || 'http://backend:4000').replace(/\/$/, '');
}

function normalizedProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider || ['personal', 'personal_api', 'yd_video', 'yadi'].includes(provider)) return PERSONAL_PROVIDER;
  if (['doubao', 'doubao_local', 'doubao_local_executor'].includes(provider)) return LOCAL_PROVIDER;
  if (['h3', 'minimax_h3', 'minimax-h3-video', 'autodl', 'autodl_comfyui', 'autodl_comfyui_video'].includes(provider)) return H3_PROVIDER;
  return provider;
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

function isPromptConfigPath(req, pathname) {
  if (req.method !== 'PUT') return false;
  return /^\/api\/batch-factory\/v11\/batches\/[^/]+(?:\/settings|\/books\/[^/]+\/override|\/books\/[^/]+\/videos\/[^/]+\/override)$/.test(pathname);
}

function promptConfigError(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'BATCH_FACTORY_SYSTEM_PRESET_INVALID';
  return error;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

const PROMPT_SELECTION_FIELDS = ['presetId', 'presetName', 'presetSlot', 'presetVersion', 'body', 'prompt'];
const ASSET_REQUIREMENTS = [
  ['extraction', 'assets.extraction', '人物场景提取预设词'],
  ['character', 'assets.character', '人物提示词预设词'],
  ['scene', 'assets.scene', '场景提示词预设词'],
  ['prop', 'assets.prop', '道具提示词预设词']
];

function removeSelectionFields(target) {
  for (const field of PROMPT_SELECTION_FIELDS) delete target[field];
}

function resolvePromptSelection(value, requirementKey, label, presetStore, resolveBody) {
  const raw = plainObject(value) ? value : {};
  const presetId = String(raw.presetId || '').trim();
  if (!presetId) return null;
  const preset = presetStore.getPublished(presetId);
  const requirement = BATCH_FACTORY_PRESET_REQUIREMENTS[requirementKey];
  if (!preset || !isPublishedPresetAllowed(preset, requirement)) {
    throw promptConfigError(`请选择个人中心已发布且匹配“${label}”的预设词`);
  }
  const body = String(resolveBody(presetStore, preset.id) || '').trim();
  if (!body) throw promptConfigError(`预设词“${preset.name || preset.id}”没有可用正文`);
  return {
    presetId: preset.id,
    presetName: preset.name,
    presetSlot: preset.protocolLock?.slot || null,
    presetVersion: preset.version,
    body
  };
}

function resolveAssetSelections(assets, presetStore, resolveBody) {
  const legacy = { presetId: assets.presetId };
  removeSelectionFields(assets);
  for (const [key, requirementKey, label] of ASSET_REQUIREMENTS) {
    let raw = assets[key];
    // Transitional support for the former one-select asset form: classify its
    // server-side preset into exactly one typed asset slot.
    if (!plainObject(raw) && legacy.presetId) {
      const legacyPreset = presetStore.getPublished(String(legacy.presetId));
      if (legacyPreset && isPublishedPresetAllowed(legacyPreset, BATCH_FACTORY_PRESET_REQUIREMENTS[requirementKey])) raw = legacy;
    }
    const selection = resolvePromptSelection(raw, requirementKey, label, presetStore, resolveBody);
    if (selection) assets[key] = selection;
    else delete assets[key];
  }
}

function resolveConstraintSelections(constraints, presetStore, resolveBody) {
  const legacy = { presetId: constraints.presetId };
  const values = Array.isArray(constraints.selections)
    ? constraints.selections
    : (legacy.presetId ? [legacy] : []);
  removeSelectionFields(constraints);
  constraints.selections = values
    .map(value => resolvePromptSelection(value, 'constraints', '生产约束预设词', presetStore, resolveBody))
    .filter(Boolean);
}

function resolveModuleSelection(module, requirementKey, label, presetStore, resolveBody) {
  const selection = resolvePromptSelection(module, requirementKey, label, presetStore, resolveBody);
  removeSelectionFields(module);
  if (selection) Object.assign(module, selection);
}

function enrichBatchFactorySystemPresetConfig(input, presetStore, resolveBody = resolveSystemPresetBody) {
  if (!plainObject(input) || !plainObject(input.patch) || !plainObject(input.patch.aiPromptConfig)) return input;
  if (!presetStore || typeof presetStore.getPublished !== 'function') {
    throw promptConfigError('批量工厂系统预设词服务暂不可用');
  }
  const next = JSON.parse(JSON.stringify(input));
  const config = next.patch.aiPromptConfig;
  if (plainObject(config.assets)) resolveAssetSelections(config.assets, presetStore, resolveBody);
  if (plainObject(config.constraints)) resolveConstraintSelections(config.constraints, presetStore, resolveBody);
  if (plainObject(config.video)) resolveModuleSelection(config.video, 'video', '视频提示词预设词', presetStore, resolveBody);
  if (plainObject(config.visual)) resolveModuleSelection(config.visual, 'visual', '画面提示词预设词', presetStore, resolveBody);
  return next;
}

function redactBatchFactorySystemPromptBodies(value, inPromptConfig = false) {
  if (Array.isArray(value)) return value.map(item => redactBatchFactorySystemPromptBodies(item, inPromptConfig));
  if (!plainObject(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const protectedConfig = inPromptConfig || key === 'aiPromptConfig';
    if (protectedConfig && (key === 'body' || key === 'prompt')) continue;
    next[key] = redactBatchFactorySystemPromptBodies(item, protectedConfig);
  }
  return next;
}

function personalApiKeyForUser(req) {
  const config = readConfig(req.username);
  return getVideoApiKey(config, 'yd');
}

async function syncPersonalProviderConfig(req, options, { allowMissing = false } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const base = String(options.goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
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
      model: PERSONAL_MODEL,
      apiKey
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
  const personalKey = getVideoApiKey(configReader(req.username), 'h3');
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
  const base = String(options.goBaseUrl || resolveV11GoBaseUrl()).replace(/\/$/, '');
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
    body: JSON.stringify({ provider: H3_PROVIDER, model: H3_MODEL, apiKey, createUrl: H3_CREATE_URL, tasksUrl: H3_TASKS_URL }),
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
    await syncH3ProviderConfig(req, options, { allowMissing });
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
  await syncPersonalProviderConfig(req, options, { allowMissing });
}

function createBatchFactoryV11Router(options = {}) {
  const upstreamOptions = { ...options, goBaseUrl: options.goBaseUrl || resolveV11GoBaseUrl() };
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      const parsed = new URL(req.originalUrl || req.url, 'http://qiantie.local');
      await prepareProviderRequest(req, upstreamOptions, parsed.pathname);
      if (isPromptConfigPath(req, parsed.pathname)) {
        req.body = enrichBatchFactorySystemPresetConfig(req.body, upstreamOptions.presetStore);
      }
      return await proxyV11Request(req, res, {
        ...upstreamOptions,
        transformJSONResponse: redactBatchFactorySystemPromptBodies
      });
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = Number.isInteger(error?.status) ? error.status : 502;
      const code = error?.code || 'BFV11_UPSTREAM_UNAVAILABLE';
      const message = status >= 400 && status < 500 ? error.message : 'Batch Factory V11 Go service unavailable';
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
  resolveV11GoBaseUrl,
  isPromptConfigPath,
  enrichBatchFactorySystemPresetConfig,
  redactBatchFactorySystemPromptBodies,
  createBatchFactoryV11Router
};
