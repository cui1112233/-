const express = require('express');
const https = require('https');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');

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

const PROCESS_PRESET_IDS = { induce: 'novel-fetch-induce', hook: 'novel-fetch-hook' };
const PROCESS_TEXT_LIMIT = 120000;
const MAX_PROCESS_ITEMS = 50;

function isProcessMode(value) {
  return Object.hasOwn(PROCESS_PRESET_IDS, value);
}

function extractProcessContent(upstreamText, statusCode) {
  if (statusCode >= 400) throw new Error(`上游请求失败（${statusCode}）`);
  let parsed;
  try {
    parsed = JSON.parse(upstreamText);
  } catch (_) {
    throw new Error('上游返回非 JSON 数据');
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('上游响应缺少内容');
  return content;
}

async function defaultProcessWithAI(username, systemPrompt, novelText) {
  const config = readConfig(username);
  ensureReadyConfig(config);
  const payload = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: novelText }
    ],
    max_tokens: 4096,
    temperature: 0.4
  };
  const upstream = await requestUpstream(config, payload, collectResponse, { timeoutMs: 120000 });
  return extractProcessContent(upstream.text, upstream.statusCode);
}

function splitReportAndText(content) {
  const text = String(content || '');
  const reportMarkers = ['### 一、合规检测报告', '### 一、优化说明', '## 合规检测报告', '## 优化说明', '一、合规检测报告', '一、优化说明'];
  const marker = reportMarkers.find(m => text.includes(m));
  if (!marker) return { report: '', rest: text };
  const index = text.indexOf(marker);
  const secondSection = text.indexOf('### 二、优化后全文', index);
  if (secondSection === -1) return { report: text.slice(0, index).trim(), rest: text.slice(index).trim() };
  return { report: text.slice(0, secondSection).trim(), rest: text.slice(secondSection + '### 二、优化后全文'.length).trim() };
}

function createNovelFetchRouter({ fetchUpstream: customFetch, auth = apiAuth, presetStore, processWithAI } = {}) {
  const fetchOne = customFetch || fetchUpstream;
  const processOne = processWithAI || defaultProcessWithAI;
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

  router.post('/process', async (req, res) => {
    try {
      const { mode, items } = req.body || {};
      if (!isProcessMode(mode)) return res.status(400).json({ error: '无效的处理类型' });
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请选择要处理的书籍' });
      if (items.length > MAX_PROCESS_ITEMS) return res.status(400).json({ error: `一次最多处理 ${MAX_PROCESS_ITEMS} 本` });
      const normalized = [];
      for (const item of items) {
        const bookId = String(item && item.bookId || '').trim();
        const text = String(item && item.text || '');
        if (!isValidBookId(bookId)) return res.status(400).json({ error: `书籍 ID 格式不正确：${bookId}` });
        if (!text) return res.status(400).json({ error: `书籍 ${bookId} 缺少正文` });
        normalized.push({ bookId, text: text.slice(0, PROCESS_TEXT_LIMIT) });
      }
      const presetId = PROCESS_PRESET_IDS[mode];
      const preset = presetStore && presetStore.getPublished(presetId);
      if (!preset || preset.module !== 'novel-fetch' || preset.protocolLock?.format !== 'novel-fetch-process' || preset.protocolLock?.operation !== mode) {
        return res.status(400).json({ error: '未发布该处理预设' });
      }
      const results = await Promise.all(normalized.map(async ({ bookId, text }) => {
        try {
          const processed = await processOne(req.username, preset.body, text);
          const { report, rest } = splitReportAndText(processed);
          return { bookId, status: 'ok', text: rest, report, error: null };
        } catch (error) {
          return { bookId, status: 'error', text: null, report: null, error: error.message || '处理失败' };
        }
      }));
      return res.json({ results });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createNovelFetchRouter, PLATFORMS, extractProcessContent, splitReportAndText };
