const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, writeConfig, publicConfig, DEFAULT_CONFIG } = require('../lib/shared');

const router = express.Router();
router.use(apiAuth);

// GET /api/config — 获取配置（不含 apiKey）
router.get('/', (req, res) => {
  res.json(publicConfig(readConfig(req.username)));
});

// POST /api/config — 保存配置
router.post('/', (req, res) => {
  const body = req.body;
  const oldConfig = readConfig(req.username);
  const nextConfig = {
    provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
    baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
    apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey
  };
  writeConfig(req.username, nextConfig);
  res.json(publicConfig(nextConfig));
});

module.exports = router;
