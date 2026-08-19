const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, DEFAULT_CONFIG } = require('../lib/shared');
const { normalizeStorageRoot } = require('../lib/storage-root');

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

function normalizeNotifications(value, fallback = {}) {
  const volume = Number(value?.soundVolume);
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : (fallback.soundEnabled ?? true),
    petVisible: typeof value?.petVisible === 'boolean' ? value.petVisible : (fallback.petVisible ?? true),
    soundVolume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 60
  };
}

// 内置头像：{ emoji, background }。非法值回退到 fallback（一般为旧值或 null）。
function normalizeAvatar(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback || null;
  const emoji = typeof value.emoji === 'string' && value.emoji.trim() && value.emoji.trim().length <= 8
    ? value.emoji.trim()
    : null;
  const background = typeof value.background === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.background.trim())
    ? value.background.trim()
    : null;
  if (!emoji || !background) return fallback || null;
  return { emoji, background };
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

// GET /api/config — 获取配置（不含 apiKey）
router.get('/', (req, res) => {
  const config = readConfig(req.username);
  config.pet = normalizePetConfig(config.pet);
  config.tts = normalizeTtsConfig(config.tts);
  config.notifications = normalizeNotifications(config.notifications);
  config.avatar = normalizeAvatar(config.avatar);
  res.json(publicConfig(config));
});

// POST /api/config — 保存配置
router.post('/', (req, res) => {
  const body = req.body;
  // POST 内、写回配置前：校验本地存储文件夹
  if (req.body && typeof req.body.storageRoot === 'string') {
    const result = normalizeStorageRoot(req.body.storageRoot);
    if (result.error) return res.status(400).json({ error: result.error });
    req.body.storageRoot = result.value;
  }
  const oldConfig = readConfig(req.username);
  const nextConfig = {
    provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
    baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
    apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
    storageRoot: typeof body.storageRoot === 'string' ? body.storageRoot : (oldConfig.storageRoot || ''),
    pet: normalizePetConfig(body.pet, oldConfig.pet),
    tts: normalizeTtsConfig(body.tts, oldConfig.tts),
    notifications: normalizeNotifications(body.notifications, oldConfig.notifications),
    avatar: normalizeAvatar(body.avatar, oldConfig.avatar)
  };
  writeConfig(req.username, nextConfig);
  res.json(publicConfig(nextConfig));
});

module.exports = router;
module.exports.normalizeNotifications = normalizeNotifications;
module.exports.normalizeAvatar = normalizeAvatar;
