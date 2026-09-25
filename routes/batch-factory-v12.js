const express = require('express');
const {
  createBatchFactoryV11Router,
  normalizedBookGender,
  normalizedBookStyle,
  prepareBatchFactoryBookClassification,
  v11JSONRequest
} = require('./batch-factory-v11');
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

// Classification is an enhancement of a successfully captured source, never a
// prerequisite for creating or producing a batch.  Keep every result isolated
// so an unavailable text model cannot strand the remaining books.
async function classifyBatchFactoryBooks({ books, classifyBook } = {}) {
  const items = Array.isArray(books) ? books : [];
  const results = [];
  for (const book of items) {
    const bookId = String(book?.id || '').trim();
    if (!bookId) continue;
    const metadata = book?.sourceMetadata && typeof book.sourceMetadata === 'object' ? book.sourceMetadata : {};
    const gender = normalizedBookGender(metadata.gender);
    const style = normalizedBookStyle(metadata.style);
    if (gender && style) {
      results.push({
        bookId,
        status: 'reused',
        classification: { gender, style, tags: String(metadata.tags || '').trim(), reason: String(metadata.classifyReason || '').trim() },
        reused: true
      });
      continue;
    }
    if (!String(book?.sourceText || '').trim()) {
      results.push({ bookId, status: 'skipped', reason: 'SOURCE_TEXT_REQUIRED' });
      continue;
    }
    try {
      const result = await classifyBook(book);
      results.push({
        bookId,
        status: result?.reused ? 'reused' : 'classified',
        classification: result?.classification || {},
        reused: result?.reused === true
      });
    } catch (error) {
      results.push({ bookId, status: 'failed', error: String(error?.message || '男女频和风格识别失败') });
    }
  }
  return results;
}

// Repairs only legacy/manual intake records where the source was never saved.
// The Go store enforces the same fill-only rule atomically so retries cannot
// replace a real source fetched by someone else.
async function refillMissingBatchFactoryBookSource({ book, fetchDirectOriginal, captureSource, now = () => new Date() } = {}) {
  if (String(book?.sourceText || '').trim()) throw new Error('当前书已有正文，不能覆盖');
  const rawBookID = String(book?.bookId || '').trim();
  // Older smart-input rows occasionally persisted "Book ID + title" in the
  // bookId field. The source ID is the leading transport-safe token; retaining
  // the title in that malformed field must not make the saved book impossible
  // to repair.
  const bookId = rawBookID.match(/^[A-Za-z0-9_.-]+/)?.[0] || '';
  const platformId = String(book?.platform || book?.sourceMetadata?.platformId || '').trim();
  const maxTxt = Number(book?.sourceMetadata?.contentCaptureCharacters || 4000);
  if (!bookId || !platformId || !Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) throw new Error('当前书缺少可用的书城、Book ID 或正文范围');
  const fetched = await fetchDirectOriginal({ bookId, platformId, maxTxt });
  const sourceText = String(fetched?.text || '').trim();
  if (!sourceText) throw new Error('没有返回正文');
  const response = await captureSource({
    sourceText,
    expectedRevision: Number(book?.revision || 0),
    sourceMetadata: {
      sourceMode: 'manual_refetched',
      sourceFetchedAt: now().toISOString(),
      sourceFetchAttempts: Number(fetched?.attempts || 0),
      sourceCaptureCharacters: maxTxt,
      sourceBookId: bookId,
      ...(fetched?.bookinfo?.work_title ? { sourceBookTitle: String(fetched.bookinfo.work_title) } : {})
    }
  });
  return { ...response, fetched: { length: sourceText.length, attempts: fetched?.attempts || 0, bookinfo: fetched?.bookinfo || {} } };
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
  router.post('/batches/:batchId/books/:bookId/fetch-original', async (req, res) => {
    try {
      const batchID = encodeURIComponent(String(req.params.batchId || ''));
      const bookID = encodeURIComponent(String(req.params.bookId || ''));
      const goOptions = { goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret };
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const loaded = await v11JSONRequest({ ...account, method: 'GET', pathname: `${V11_BASE}/batches/${batchID}`, ...goOptions });
      const batch = loaded?.batch || loaded;
      const book = (Array.isArray(batch?.books) ? batch.books : []).find(item => String(item?.id) === String(req.params.bookId));
      if (!book) return res.status(404).json({ error: '小说不存在' });
      const store = createMySQLWorkshopStore({ targetBaseUrl: options.targetBaseUrl, bridgeSecret: options.bridgeSecret, account });
      const result = await refillMissingBatchFactoryBookSource({
        book,
        fetchDirectOriginal: input => store.fetchDirectOriginal(input),
        captureSource: payload => v11JSONRequest({ ...account, method: 'PUT', pathname: `${V11_BASE}/batches/${batchID}/books/${bookID}/source`, payload, ...goOptions })
      });
      let classification;
      try {
        const classified = await prepareBatchFactoryBookClassification(req, { batchId: String(req.params.batchId), bookId: String(req.params.bookId) }, options);
        classification = { status: classified?.reused ? 'reused' : 'classified', classification: classified?.classification || {} };
      } catch (classificationError) {
        classification = { status: 'failed', error: String(classificationError?.message || '男女频和风格识别失败') };
      }
      return res.json({ ...result, classification });
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ error: error?.message || '获取正文失败' });
    }
  });
  router.post('/batches/:batchId/classify-fetched-metadata', async (req, res) => {
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const batchId = String(req.params.batchId || '').trim();
      const goOptions = { goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl, now: options.now };
      const loaded = await v11JSONRequest({
        ...account,
        method: 'GET',
        pathname: `${V11_BASE}/batches/${encodeURIComponent(batchId)}`,
        ...goOptions
      });
      const batch = loaded?.batch || loaded;
      if (!batch?.id) return res.status(404).json({ error: '批量工程不存在' });
      const results = await classifyBatchFactoryBooks({
        books: batch.books,
        classifyBook: book => prepareBatchFactoryBookClassification(req, { batchId, bookId: String(book.id) }, options)
      });
      return res.json({ results });
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ error: error?.message || '识别男女频和风格失败' });
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
  classifyBatchFactoryBooks,
  fetchBatchFactoryOriginals,
  refillMissingBatchFactoryBookSource,
  isNativeV12H3Path,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
};
