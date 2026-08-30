const express = require('express');
const { apiAuth } = require('../middleware/auth');

const router = express.Router();
router.use(apiAuth);

// GET /api/prompt 已禁用：真实提示词只能由后端内部读取并拼接。
router.get('/', (req, res) => {
  res.status(404).json({ error: 'Prompt files are not exposed to clients' });
});

module.exports = router;
