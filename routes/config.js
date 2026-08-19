const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, normalizeImageConfig, DEFAULT_CONFIG } = require('../lib/shared');
const { syncAccountAIConfig } = require('./shuihuo-production');

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

function createConfigRouter({ shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  // GET /api/config — 获取配置（不含 apiKey）
  router.get('/', (req, res) => {
    const config = readConfig(req.username);
    config.pet = normalizePetConfig(config.pet);
    config.tts = normalizeTtsConfig(config.tts);
    res.json(publicConfig(config));
  });

  // POST /api/config — 保存配置
  router.post('/', async (req, res) => {
    const body = req.body;
    const oldConfig = readConfig(req.username);
    const nextConfig = {
      provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
      baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
      model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
      apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
      image: normalizeImageConfig(body.image, oldConfig.image),
      pet: normalizePetConfig(body.pet, oldConfig.pet),
      tts: normalizeTtsConfig(body.tts, oldConfig.tts)
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
    res.json(publicConfig(nextConfig));
  });

  return router;
}

module.exports = { createConfigRouter, normalizePetConfig, normalizeTtsConfig };
