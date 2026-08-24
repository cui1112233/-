const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, DEFAULT_CONFIG } = require('../lib/shared');

const router = express.Router();
router.use(apiAuth);

function normalizePetConfig(value, fallback) {
  if (!value || value.id !== 'stacky') {
    return fallback || DEFAULT_CONFIG.pet;
  }
  return {
    id: 'stacky',
    displayName: 'CM',
    description: 'CM，前贴的桌面宠物。',
    spriteVersionNumber: 2,
    spritesheetPath: '/pets/stacky/spritesheet.webp'
  };
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

function apiManagementState(req) {
  const member = req.app.locals.memberStore?.getMember(req.username);
  return {
    member,
    canManageApi: !member || member.role !== 'member'
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
    image: {
      ...safe.image,
      baseUrl: '',
      model: '',
      displayName: '',
      hasApiKey: false
    },
    canManageApi: false,
    managedBy: member?.boundTo || null
  };
}

// GET /api/config — 获取配置（不含 apiKey）
router.get('/', (req, res) => {
  const config = readConfig(req.username);
  config.pet = normalizePetConfig(config.pet);
  config.tts = normalizeTtsConfig(config.tts);
  const { member, canManageApi } = apiManagementState(req);
  if (!canManageApi) return res.json(managedPublicConfig(config, member));
  return res.json({ ...publicConfig(config), canManageApi: true, managedBy: null });
});

// POST /api/config — 保存配置。MEMBER 仅可保存个人偏好，不可写入模型连接。
router.post('/', (req, res) => {
  const body = req.body || {};
  const oldConfig = readConfig(req.username);
  const { member, canManageApi } = apiManagementState(req);

  if (!canManageApi) {
    const nextConfig = {
      ...oldConfig,
      pet: normalizePetConfig(body.pet, oldConfig.pet),
      tts: normalizeTtsConfig(body.tts, oldConfig.tts)
    };
    writeConfig(req.username, nextConfig);
    return res.json(managedPublicConfig(nextConfig, member));
  }

  const nextConfig = {
    provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
    baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
    apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
    image: body.image ? {
      ...(oldConfig.image || DEFAULT_CONFIG.image),
      ...body.image,
      apiKey: body.image.apiKey ? body.image.apiKey : oldConfig.image?.apiKey
    } : (oldConfig.image || DEFAULT_CONFIG.image),
    pet: normalizePetConfig(body.pet, oldConfig.pet),
    tts: normalizeTtsConfig(body.tts, oldConfig.tts)
  };
  writeConfig(req.username, nextConfig);
  return res.json({ ...publicConfig(nextConfig), canManageApi: true, managedBy: null });
});

module.exports = router;
