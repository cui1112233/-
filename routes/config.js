const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, normalizeImageConfig, normalizeVideoConfig, normalizeModelDirectory, DEFAULT_CONFIG } = require('../lib/shared');
const { syncAccountAIConfig } = require('./shuihuo-production');
const { normalizeStorageRoot } = require('../lib/storage-root');
const { normalizePetConfig } = require('../lib/pet-catalog');

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
  return { member, canManageApi: !member || member.role !== 'member' };
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

function normalizeModelsForSave(value, previous) {
  if (value === undefined) return normalizeModelDirectory(previous?.models, previous);
  const oldById = new Map(normalizeModelDirectory(previous?.models, previous).map(model => [model.id, model]));
  const submitted = Array.isArray(value) ? value : [];
  return normalizeModelDirectory(submitted.map(model => ({
    ...model,
    apiKey: model?.apiKey || oldById.get(model?.id)?.apiKey || ''
  })), previous);
}

function createConfigRouter({ shuihuoGateway, memberStore } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  // GET /api/config — 获取配置（不含 apiKey）
  router.get('/', (req, res) => {
    const config = readConfig(req.username);
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
    const oldConfig = readConfig(req.username);
    const { member, canManageApi } = apiManagementState(req, memberStore);
    if (!canManageApi) {
      const nextConfig = {
        ...oldConfig,
        models: oldConfig.models,
        storageRoot: typeof body.storageRoot === 'string' ? body.storageRoot : (oldConfig.storageRoot || ''),
        pet: normalizePetConfig(body.pet, oldConfig.pet),
        tts: normalizeTtsConfig(body.tts, oldConfig.tts),
        notifications: normalizeNotifications(body.notifications, oldConfig.notifications),
        avatar: normalizeAvatar(body.avatar, oldConfig.avatar)
      };
      writeConfig(req.username, nextConfig);
      return res.json(managedPublicConfig(nextConfig, member));
    }
    const nextConfig = {
      ...oldConfig,
      provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
      baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
      model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
      apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
      models: normalizeModelsForSave(body.models, oldConfig),
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
    writeConfig(req.username, nextConfig);
    res.json({ ...publicConfig(nextConfig), canManageApi: true, managedBy: null });
  });

  return router;
}

module.exports = { createConfigRouter, normalizePetConfig, normalizeTtsConfig, normalizeNotifications, normalizeAvatar, managedPublicConfig };
