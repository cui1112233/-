const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, normalizeImageConfig, normalizeVideoConfig, DEFAULT_CONFIG } = require('../lib/shared');
const { syncAccountAIConfig } = require('./shuihuo-production');
const { normalizeStorageRoot } = require('../lib/storage-root');
const { normalizePetConfig } = require('../lib/pet-catalog');
const {
  listVisibleModels,
  listManagerModels,
  saveManagerModel,
  updateManagerModel,
  removeManagerModel
} = require('../lib/model-catalog-runtime');
const { createModelReferenceResolver } = require('../lib/model-reference-resolver');
const { createSignedBridgeHeaders } = require('../lib/batch-factory-v11/go-proxy');

const LOCAL_DOUBAO_MODEL_ID = 'local-doubao-executor-video';

async function defaultExecutorPairingStatus({ username, account, shuihuoGateway, fetchImpl = globalThis.fetch }) {
  if (!fetchImpl) return false;
  const base = String(shuihuoGateway?.targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  const secret = shuihuoGateway?.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const pathname = '/api/shuihuo-production/local-executors';
  try {
    const response = await fetchImpl(`${base}${pathname}`, {
      headers: createSignedBridgeHeaders({
        username,
        isOwner: account?.isOwner === true,
        method: 'GET',
        pathname,
        secret
      })
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Array.isArray(payload?.executors)
      && payload.executors.some(executor => executor?.platform === 'doubao');
  } catch {
    return false;
  }
}

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

function normalizeNotifications(value, fallback = {}) {
  const volume = Number(value?.soundVolume);
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : (fallback.soundEnabled ?? true),
    petVisible: typeof value?.petVisible === 'boolean' ? value.petVisible : (fallback.petVisible ?? true),
    soundVolume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 60
  };
}

function normalizeAvatar(value, fallback = null) {
  const emoji = typeof value?.emoji === 'string' ? value.emoji.trim() : '';
  const background = typeof value?.background === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.background.trim())
    ? value.background.trim()
    : '';
  return emoji && background ? { emoji, background } : fallback;
}

function apiManagementState(req, memberStore) {
  const member = memberStore?.getMember?.(req.username);
  return {
    member,
    canManageApi: Boolean(member?.active && ['dev', 'manager'].includes(member.role))
  };
}

function managedPublicConfig(config, member) {
  const safe = publicConfig(config);
  return {
    ...safe,
    provider: 'managed',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    image: { ...safe.image, baseUrl: '', model: '', displayName: '', hasApiKey: false },
    video: { ...safe.video, baseUrl: '', model: '', displayName: '', hasApiKey: false },
    canManageApi: false,
    managedBy: member?.boundTo || null
  };
}

function createConfigRouter({
  shuihuoGateway,
  memberStore,
  configReader = readConfig,
  configWriter = writeConfig,
  authenticate = apiAuth,
  isModelReferenced,
  batchFactoryStoreFactory,
  accountReader,
  getExecutorPairingStatus = defaultExecutorPairingStatus
} = {}) {
  const router = express.Router();
  router.use(authenticate);
  const resolveModelReference = isModelReferenced || createModelReferenceResolver({
    configReader,
    batchFactoryStoreFactory,
    accountReader
  });

  function requireApiManager(req, res, next) {
    if (!apiManagementState(req, memberStore).canManageApi) return res.status(403).json({ error: '仅管理者可以管理模型' });
    next();
  }

  function sendModelError(res, error) {
    return res.status(error?.status || 400).json({ error: error?.message || '模型配置处理失败' });
  }

  async function readAndPersistExecutorPairing(req) {
    const paired = await getExecutorPairingStatus({
      username: req.username,
      account: req.auth?.account,
      shuihuoGateway
    });
    const config = configReader(req.username) || {};
    const rawCatalog = Array.isArray(config.modelCatalog) ? config.modelCatalog : [];
    const index = rawCatalog.findIndex(model => model?.id === LOCAL_DOUBAO_MODEL_ID);
    if (index < 0) return paired;
    if (rawCatalog[index]?.executorPaired === paired) return paired;
    const nextCatalog = rawCatalog.map((model, position) => position === index ? { ...model, executorPaired: paired } : model);
    configWriter(req.username, { ...config, modelCatalog: nextCatalog, modelCatalogVersion: 1 });
    return paired;
  }

  router.get('/models', (req, res) => {
    if (apiManagementState(req, memberStore).canManageApi) {
      return res.json({ models: listManagerModels({
        username: req.username,
        kind: req.query.kind,
        configReader
      }) });
    }
    res.json({ models: listVisibleModels({
      username: req.username,
      kind: req.query.kind,
      memberStore,
      configReader
    }) });
  });

  router.get('/models/local-doubao-executor-video/pairing-status', requireApiManager, async (req, res) => {
    const executorPaired = await readAndPersistExecutorPairing(req);
    return res.json({ executorPaired });
  });

  router.post('/models', requireApiManager, async (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      if (body.id === LOCAL_DOUBAO_MODEL_ID) {
        body.executorPaired = await readAndPersistExecutorPairing(req);
        if (body.enabled && !body.executorPaired) throw Object.assign(new Error('请先完成本地豆包执行器配对'), { status: 422 });
      }
      const model = saveManagerModel(req.username, body, { configReader, configWriter });
      return res.status(201).json({ model });
    } catch (error) {
      return sendModelError(res, error);
    }
  });

  router.patch('/models/:modelId', requireApiManager, async (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      if (req.params.modelId === LOCAL_DOUBAO_MODEL_ID) {
        body.executorPaired = await readAndPersistExecutorPairing(req);
        if (body.enabled && !body.executorPaired) throw Object.assign(new Error('请先完成本地豆包执行器配对'), { status: 422 });
      }
      const model = updateManagerModel(req.username, req.params.modelId, body, { configReader, configWriter });
      return res.json({ model });
    } catch (error) {
      return sendModelError(res, error);
    }
  });

  router.delete('/models/:modelId', requireApiManager, async (req, res) => {
    try {
      await removeManagerModel(req.username, req.params.modelId, { configReader, configWriter, isModelReferenced: resolveModelReference });
      return res.status(204).end();
    } catch (error) {
      return sendModelError(res, error);
    }
  });

  // GET /api/config — 获取配置（不含 apiKey）
  router.get('/', (req, res) => {
    const config = configReader(req.username);
    config.pet = normalizePetConfig(config.pet);
    config.tts = normalizeTtsConfig(config.tts);
    config.notifications = normalizeNotifications(config.notifications);
    config.avatar = normalizeAvatar(config.avatar);
    const { member, canManageApi } = apiManagementState(req, memberStore);
    if (!canManageApi) return res.json(managedPublicConfig(config, member));
    return res.json({ ...publicConfig(config), canManageApi: true, managedBy: null });
  });

  // POST /api/config — 保存配置
  router.post('/', async (req, res) => {
    const body = req.body;
    if (typeof body?.storageRoot === 'string') {
      const storageRoot = normalizeStorageRoot(body.storageRoot);
      if (storageRoot.error) return res.status(400).json({ error: storageRoot.error });
      body.storageRoot = storageRoot.value;
    }
    const oldConfig = configReader(req.username);
    const { member, canManageApi } = apiManagementState(req, memberStore);
    if (!canManageApi) {
      const nextConfig = {
        ...oldConfig,
        storageRoot: typeof body.storageRoot === 'string' ? body.storageRoot : (oldConfig.storageRoot || ''),
        pet: normalizePetConfig(body.pet, oldConfig.pet),
        tts: normalizeTtsConfig(body.tts, oldConfig.tts),
        notifications: normalizeNotifications(body.notifications, oldConfig.notifications),
        avatar: normalizeAvatar(body.avatar, oldConfig.avatar)
      };
      configWriter(req.username, nextConfig);
      return res.json(managedPublicConfig(nextConfig, member));
    }
    const nextConfig = {
      provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
      baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
      model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
      apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
      storageRoot: typeof body.storageRoot === 'string' ? body.storageRoot : (oldConfig.storageRoot || ''),
      image: normalizeImageConfig(body.image, oldConfig.image),
      video: normalizeVideoConfig(body.video, oldConfig.video),
      pet: normalizePetConfig(body.pet, oldConfig.pet),
      tts: normalizeTtsConfig(body.tts, oldConfig.tts),
      notifications: normalizeNotifications(body.notifications, oldConfig.notifications),
      avatar: normalizeAvatar(body.avatar, oldConfig.avatar)
    };
    if (shuihuoGateway) {
      try {
        await syncAccountAIConfig({
          ...shuihuoGateway,
          username: req.auth.account.username,
          isOwner: req.auth.account.isOwner === true,
          config: nextConfig
        });
      } catch (error) {
        return res.status(error.status || 503).json({ error: error.message || '水货生产的 AI 配置同步失败' });
      }
    }
    configWriter(req.username, nextConfig);
    res.json({ ...publicConfig(nextConfig), canManageApi: true, managedBy: null });
  });

  return router;
}

module.exports = { createConfigRouter, normalizePetConfig, normalizeTtsConfig, normalizeNotifications, normalizeAvatar, managedPublicConfig, defaultExecutorPairingStatus };
