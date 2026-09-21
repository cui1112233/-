const express = require('express');
const { createBatchFactoryV11Router } = require('./batch-factory-v11');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

const V12_BASE = '/api/batch-factory/v12';
const V11_BASE = '/api/batch-factory/v11';

// V12 owns the public API namespace. During the one-time batch upgrade window
// it adapts durable V11 records through the existing, tested V11 service
// boundary. The browser never calls the V11 write API directly.
function rewriteV12PathForLegacyRead(value) {
  const pathname = String(value || '');
  if (!pathname.startsWith(V12_BASE + '/') && pathname !== V12_BASE) return '';
  return V11_BASE + pathname.slice(V12_BASE.length);
}

function isNativeV12H3Path(value) {
  const parsed = new URL(String(value || ''), 'http://qiantie.local');
  return /^\/api\/batch-factory\/v12\/batches\/[^/]+\/books\/[^/]+\/h3\/(?:director|audio-measurement|compile|trace)$/.test(parsed.pathname);
}

function routeV12UpstreamPath(value) {
  const original = String(value || '');
  if (isNativeV12H3Path(original)) return original;
  return rewriteV12PathForLegacyRead(original);
}

function rejectLegacyV11Mutations(req, res, next) {
	if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) return next();
	return res.status(410).json({
		error: "批量工厂已升级到 V12，请从 V12 继续生产",
		code: "BATCH_FACTORY_V11_READ_ONLY",
		upgradePath: V12_BASE,
	});
}

async function fetchBatchFactoryOriginals(payload, fetchDirectOriginal) {
  const numericPlatform = Number(payload?.platform);
  if (!Number.isInteger(numericPlatform) || numericPlatform <= 0) throw new Error('无效的平台 ID');
  const maxTxt = Number(payload?.maxTxt);
  if (!Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) throw new Error('字数需为 100–100000 的整数');
  const bookIds = [...new Set((Array.isArray(payload?.bookIds) ? payload.bookIds : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!bookIds.length) throw new Error('请提供书籍 ID 列表');
  if (bookIds.length > 50) throw new Error('一次最多获取 50 本书');
  const results = await Promise.all(bookIds.map(async bookId => {
    try {
      const fetched = await fetchDirectOriginal({ bookId, platformId: String(numericPlatform), maxTxt });
      const data = String(fetched?.text || '');
      if (!data) throw new Error('没有返回正文');
      return {
        bookId,
        platform: numericPlatform,
        status: 'ok',
        data,
        error: null,
        length: data.length,
        attempts: fetched.attempts,
        bookinfo: fetched.bookinfo || {}
      };
    } catch (error) {
      return { bookId, platform: numericPlatform, status: 'error', data: null, error: error?.message || '获取失败', length: 0 };
    }
  }));
  return { results };
}

function createBatchFactoryV12Router(options = {}) {
  const legacy = createBatchFactoryV11Router(options);
  const router = express.Router();
  router.post('/fetch-originals', async (req, res) => {
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const store = createMySQLWorkshopStore({
        targetBaseUrl: options.targetBaseUrl,
        bridgeSecret: options.bridgeSecret,
        account
      });
      const result = await fetchBatchFactoryOriginals(req.body || {}, input => store.fetchDirectOriginal(input));
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error?.message || '获取内容失败' });
    }
  });
  router.use((req, res, next) => {
    const originalURL = req.originalUrl;
    const rewritten = routeV12UpstreamPath(originalURL);
    if (!rewritten) return next();
    req.originalUrl = rewritten;
    res.setHeader('X-Batch-Factory-Version', 'v12');
    return legacy(req, res, error => {
      req.originalUrl = originalURL;
      next(error);
    });
  });
  return router;
}

module.exports = {
  V12_BASE,
  fetchBatchFactoryOriginals,
  isNativeV12H3Path,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
};
