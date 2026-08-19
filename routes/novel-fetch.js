const express = require('express');
const https = require('https');
const { apiAuth } = require('../middleware/auth');

const PLATFORMS = [
  { id: 1, name: '黑岩付费' },
  { id: 2, name: '番茄付费' },
  { id: 3, name: '七猫付费' },
  { id: 4, name: '点众付费' },
  { id: 7, name: '番茄免费' },
  { id: 15, name: '知乎付费' },
  { id: 20, name: '掌阅付费' },
  { id: 26, name: '卓越付费' },
  { id: 29, name: '九州书城' },
  { id: 31, name: '掌文付费' }
];

const UPSTREAM_HOST = 'txt.121w.com';
const UPSTREAM_PATH = '/api.php';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BOOK_IDS = 50;

const platformNameById = new Map(PLATFORMS.map(p => [p.id, p.name]));

function isValidBookId(value) {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function fetchUpstream(bookId, platform, maxTxt) {
  return new Promise((resolve, reject) => {
    const url = `https://${UPSTREAM_HOST}${UPSTREAM_PATH}?bookid=${encodeURIComponent(bookId)}&platform=${encodeURIComponent(platform)}&max_txt=${encodeURIComponent(maxTxt)}`;
    const req = https.get(url, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(text));
        } catch (_) {
          resolve({ code: -1, msg: '上游返回非 JSON 数据', data: null });
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('请求超时'));
    });
  });
}

function createNovelFetchRouter({ fetchUpstream: customFetch, auth = apiAuth } = {}) {
  const fetchOne = customFetch || fetchUpstream;
  const router = express.Router();
  router.use(auth);

  router.post('/', async (req, res) => {
    try {
      const { platform, bookIds, maxTxt } = req.body || {};
      const numericPlatform = Number(platform);
      if (!platformNameById.has(numericPlatform)) {
        return res.status(400).json({ error: '无效的平台 ID' });
      }
      if (!Array.isArray(bookIds) || bookIds.length === 0) {
        return res.status(400).json({ error: '请提供书籍 ID 列表' });
      }
      if (bookIds.length > MAX_BOOK_IDS) {
        return res.status(400).json({ error: `一次最多获取 ${MAX_BOOK_IDS} 本书` });
      }
      const cleanedIds = [];
      for (const id of bookIds) {
        const value = String(id).trim();
        if (value && !cleanedIds.includes(value)) cleanedIds.push(value);
      }
      if (cleanedIds.length === 0) {
        return res.status(400).json({ error: '书籍 ID 不能为空' });
      }
      const invalid = cleanedIds.find(id => !isValidBookId(id));
      if (invalid) {
        return res.status(400).json({ error: `书籍 ID 格式不正确：${invalid}` });
      }
      const numericMaxTxt = Number(maxTxt);
      if (!Number.isInteger(numericMaxTxt) || numericMaxTxt < 100 || numericMaxTxt > 100000) {
        return res.status(400).json({ error: '字数需为 100–100000 的整数' });
      }

      const results = await Promise.all(cleanedIds.map(async bookId => {
        const base = { bookId, platform: numericPlatform, platformName: platformNameById.get(numericPlatform) };
        try {
          const upstream = await fetchOne(bookId, numericPlatform, numericMaxTxt);
          if (upstream && upstream.code === 200 && typeof upstream.data === 'string' && upstream.data.length > 0) {
            return { ...base, status: 'ok', data: upstream.data, error: null, length: upstream.data.length };
          }
          return { ...base, status: 'error', data: null, error: (upstream && upstream.msg) || '获取失败', length: 0 };
        } catch (error) {
          return { ...base, status: 'error', data: null, error: error.message || '获取失败', length: 0 };
        }
      }));

      return res.json({ results });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createNovelFetchRouter, PLATFORMS };
