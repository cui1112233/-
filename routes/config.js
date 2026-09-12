const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, DEFAULT_CONFIG } = require('../lib/shared');

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

function normalizePricing(value, fallback = null) {
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  if (value === undefined) return previous.currency ? { ...previous } : null;
  if (value === null) return null;
  if (!value || typeof value !== 'object') return previous.currency ? { ...previous } : null;
  const parsePrice = (candidate, oldValue = 0) => {
    if (candidate === undefined || candidate === '') return Number(oldValue) || 0;
    const number = Number(candidate);
    return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? number : Number(oldValue) || 0;
  };
  const inputPerMillion = parsePrice(value.inputPerMillion, previous.inputPerMillion);
  const outputPerMillion = parsePrice(value.outputPerMillion, previous.outputPerMillion);
  const currency = typeof value.currency === 'string' && /^[A-Za-z]{3}$/.test(value.currency.trim())
    ? value.currency.trim().toUpperCase()
    : previous.currency || 'USD';
  if (inputPerMillion === 0 && outputPerMillion === 0) return null;
  return { currency, inputPerMillion, outputPerMillion };
}

function createConfigRouter({
  configReader = readConfig,
  configWriter = writeConfig,
  publicConfigMapper = publicConfig
} = {}) {
  const router = express.Router();
  router.use(apiAuth);

  function apiManagementState(req) {
    const member = req.app.locals.memberStore?.getMember(req.username);
    return {
      member,
      canManageApi: !member || member.role !== 'member'
    };
  }

  function managedPublicConfig(config, member) {
    const safe = publicConfigMapper(config);
    return {
      ...safe,
      provider: 'managed',
      baseUrl: '',
      model: '',
      pricing: null,
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

  router.get('/', (req, res) => {
    const config = configReader(req.username);
    config.pet = normalizePetConfig(config.pet);
    config.tts = normalizeTtsConfig(config.tts);
    config.pricing = normalizePricing(config.pricing);
    const { member, canManageApi } = apiManagementState(req);
    if (!canManageApi) return res.json(managedPublicConfig(config, member));
    return res.json({ ...publicConfigMapper(config), canManageApi: true, managedBy: null });
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    const oldConfig = configReader(req.username);
    const { member, canManageApi } = apiManagementState(req);

    if (!canManageApi) {
      const nextConfig = {
        ...oldConfig,
        pet: normalizePetConfig(body.pet, oldConfig.pet),
        tts: normalizeTtsConfig(body.tts, oldConfig.tts)
      };
      configWriter(req.username, nextConfig);
      return res.json(managedPublicConfig(nextConfig, member));
    }

    const nextConfig = {
      provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
      baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
      model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
      apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey,
      pricing: normalizePricing(body.pricing, oldConfig.pricing),
      image: body.image ? {
        ...(oldConfig.image || DEFAULT_CONFIG.image),
        ...body.image,
        apiKey: body.image.apiKey ? body.image.apiKey : oldConfig.image?.apiKey
      } : (oldConfig.image || DEFAULT_CONFIG.image),
      pet: normalizePetConfig(body.pet, oldConfig.pet),
      tts: normalizeTtsConfig(body.tts, oldConfig.tts)
    };
    configWriter(req.username, nextConfig);
    return res.json({ ...publicConfigMapper(nextConfig), canManageApi: true, managedBy: null });
  });

  return router;
}

const router = createConfigRouter();
router.createConfigRouter = createConfigRouter;
router.normalizePricing = normalizePricing;

module.exports = router;
