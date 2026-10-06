const express = require('express');
const {
  createBatchFactoryV11Router,
  normalizedBookGender,
  normalizedBookStyle,
  prepareBatchFactoryBookClassification,
  sanitizeAutomationPresetConfig,
  validateBatchFactoryModelPatch,
  redactBatchFactorySystemPromptBodies,
  v11JSONRequest
} = require('./batch-factory-v11');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');
const { merge121BookInfoIntoMeta } = require('../lib/novel-fetch-workshop/121-bookinfo');
const { createAutomationPresetStore } = require('../lib/batch-factory-v11/automation-presets');
const { cleanBatchFactorySourceText, refillMissingBatchFactoryBookSource, backfillBatchFactoryBook121Metadata } = require('../lib/batch-factory-v11/source-refill');
const { normalizeProductionRetentionDays } = require('../lib/production-retention');
const { readConfig } = require('../lib/shared');

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

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deletionRetentionDays(options, username) {
  const configReader = typeof options?.configReader === 'function' ? options.configReader : readConfig;
  try { return normalizeProductionRetentionDays(configReader(username)?.productionRetentionDays); }
  catch (_) { return normalizeProductionRetentionDays(undefined); }
}

// The browser sends only the selected preset identity. Resolving its initial
// unified settings here makes creation a single durable server-side operation: a
// stale tab cannot create a batch and then lose a separate settings save.
function buildGiantBatchCreatePayload(body = {}, preset) {
  const giantAutomation = plainObject(body.giantAutomation);
  const presetID = String(giantAutomation.presetId || '').trim();
  if (!presetID || String(preset?.id || '') !== presetID) throw new Error('自动化预设不存在或不属于当前账号');
  const expectedVersion = Number(giantAutomation.expectedPresetVersion);
  if (Number.isFinite(expectedVersion) && expectedVersion > 0 && expectedVersion !== Number(preset.version)) {
    throw new Error('自动化预设版本已变化，请刷新后重试');
  }
  const config = sanitizeAutomationPresetConfig(preset.config);
  if (!Object.keys(config).length) throw new Error('自动化预设没有可用配置');
  const runMode = ['storyboard_only', 'video_no_submit', 'full_submit'].includes(String(giantAutomation.runMode || ''))
    ? String(giantAutomation.runMode)
    : 'full_submit';
  return {
    title: String(body.title || '').trim(),
    initialBatchSettings: config,
    giantAutomationPlan: {
      presetId: presetID,
      runMode,
      concurrency: Number(giantAutomation.concurrency || 0) || undefined,
      scheduledAt: String(giantAutomation.scheduledAt || '').trim()
    }
  };
}

// The project library needs names and counts, not every book's source text,
// director document, and media history. Keep the detailed contract on the
// single-batch endpoint so opening the library never freezes the browser.
function batchFactoryBatchListSummary(batch = {}) {
  const books = Array.isArray(batch?.books) ? batch.books : [];
  const batchId = String(batch?.id || '');
  const coverJobId = String(batch?.projectCoverJobId || '').trim();
  return {
    id: batchId,
    title: String(batch?.title || ''),
    createdAt: batch?.createdAt,
    updatedAt: batch?.updatedAt,
    revision: Number(batch?.revision || 0),
    bookCount: books.length,
    ...(coverJobId ? { coverMedia: { kind: 'image', url: `${V11_BASE}/batches/${encodeURIComponent(batchId)}/merge-cover/${encodeURIComponent(coverJobId)}` } } : {}),
    books: books.map(book => ({
      id: String(book?.id || ''),
      bookId: String(book?.bookId || ''),
      title: String(book?.title || ''),
      platform: String(book?.platform || '')
    }))
  };
}

function rejectLegacyV11Mutations(req, res, next) {
	if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) return next();
	return res.status(410).json({
		error: "批量工厂已升级到 V12，请从 V12 继续生产",
		code: "BATCH_FACTORY_V11_READ_ONLY",
		upgradePath: V12_BASE,
	});
}

function isV12DeletionPath(value) {
  const parsed = new URL(String(value || ''), 'http://qiantie.local');
  return /^\/api\/batch-factory\/v12\/batches\/[^/]+(?:\/books\/[^/]+)?$/.test(parsed.pathname);
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
      const rawData = String(fetched?.rawText || fetched?.text || '');
      const data = cleanBatchFactorySourceText(fetched?.text || '');
      if (!data) throw new Error('没有返回正文');
      return {
        bookId,
        platform: numericPlatform,
        status: 'ok',
        data,
        rawData,
        error: null,
        length: data.length,
        attempts: fetched.attempts,
        bookinfo: fetched.bookinfo || {},
        // This object crosses the browser intake boundary with the source
        // text.  Do not wait for the optional AI classifier to persist facts
        // already returned by 121.
        sourceMetadata: merge121BookInfoIntoMeta({}, fetched.bookinfo || {})
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

function prepareBatchFactoryBookClassificationForRequest(req, route, options = {}) {
  const prepare = typeof options.prepareBatchFactoryBookClassification === 'function'
    ? options.prepareBatchFactoryBookClassification
    : prepareBatchFactoryBookClassification;
  return prepare(req, route, options);
}

// The workbench used to refresh production, merge, automation and every book
// stage independently from the browser.  A large batch therefore turned one
// visible refresh into dozens of authenticated requests.  Keep that fan-out
// inside the server boundary and return a single, coherent snapshot instead.
async function buildBatchFactoryRuntimeSummary({ batch, automation, loadProduction, loadMerge, loadStageSummary } = {}) {
  const books = Array.isArray(batch?.books) ? batch.books : [];
  const [production, merge, summaries] = await Promise.all([
    loadProduction(),
    loadMerge(),
    Promise.all(books.map(async book => {
      const bookId = String(book?.id || '');
      try { return [bookId, await loadStageSummary(bookId)]; }
      catch (error) { return [bookId, { bookId, runs: [], unavailable: true, error: String(error?.message || '阶段状态暂不可读') }]; }
    }))
  ]);
  return {
    batchId: String(batch?.id || ''),
    batchRevision: Number(batch?.revision || 0),
    automation: automation || { state: 'idle', counts: { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 } },
    production: production || { jobs: [] },
    merge: merge || { jobs: [] },
    stageSummaries: Object.fromEntries(summaries.filter(([bookId]) => bookId))
  };
}

function batchFactoryRuntimeIndexPath(batchId) {
  return `${V11_BASE}/batches/${encodeURIComponent(String(batchId || ''))}/runtime-index`;
}

function createBatchFactoryV12Router(options = {}) {
  const automationPresetStore = options.automationPresetStore || createAutomationPresetStore({ statePath: options.automationPresetStatePath });
  const legacy = options.legacyRouter || createBatchFactoryV11Router({ ...options, automationPresetStore });
  const router = express.Router();
  const runtimeSummaryCache = new Map();
  // 浏览器运行摘要每 5 秒轮询一次；将相同账号/批量的昂贵聚合读取限为 15 秒一次，
  // 避免多个页面或抽屉同时打开时把小规格公网机的 Go/MySQL 打满。
  const runtimeSummaryTTL = 15_000;
  router.get('/batches/summary', async (req, res) => {
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const result = await v11JSONRequest({
        ...account,
        method: 'GET',
        pathname: `${V11_BASE}/batches/summary-index`,
        goBaseUrl: options.goBaseUrl,
        bridgeSecret: options.bridgeSecret,
        fetchImpl: options.fetchImpl,
        now: options.now
      });
      const batches = Array.isArray(result?.batches) ? result.batches : [];
      return res.json({ batches: batches.map(batchFactoryBatchListSummary) });
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ error: error?.message || '读取批量工程失败' });
    }
  });
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
  router.post('/intakes/:intakeId/batches', async (req, res, next) => {
    const giantAutomation = plainObject(req.body?.giantAutomation);
    if (!Object.keys(giantAutomation).length) return next();
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const presetID = String(giantAutomation.presetId || '').trim();
      const preset = presetID ? await automationPresetStore.get(account.username, presetID) : null;
      const payload = buildGiantBatchCreatePayload(req.body || {}, preset);
      validateBatchFactoryModelPatch({ ...options, username: req.username, account: req.auth?.account, patch: payload.initialBatchSettings });
      const result = await v11JSONRequest({
        ...account,
        method: 'POST',
        pathname: `${V11_BASE}/intakes/${encodeURIComponent(String(req.params.intakeId || ''))}/batches`,
        payload,
        goBaseUrl: options.goBaseUrl,
        bridgeSecret: options.bridgeSecret,
        fetchImpl: options.fetchImpl,
        now: options.now
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(Number(error?.status) || 422).json({ error: error?.message || '创建巨量素材批量失败' });
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
        platforms: store.getPlatforms?.() || [],
        fetchDirectOriginal: input => store.fetchDirectOriginal(input),
        captureSource: payload => v11JSONRequest({ ...account, method: 'PUT', pathname: `${V11_BASE}/batches/${batchID}/books/${bookID}/source`, payload, ...goOptions })
      });
      let classification;
      try {
        const classified = await prepareBatchFactoryBookClassificationForRequest(req, { batchId: String(req.params.batchId), bookId: String(req.params.bookId) }, options);
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
        classifyBook: book => prepareBatchFactoryBookClassificationForRequest(req, { batchId, bookId: String(book.id) }, options)
      });
      return res.json({ results });
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ error: error?.message || '识别男女频和风格失败' });
    }
  });
  router.post('/batches/:batchId/backfill-121-metadata', async (req, res) => {
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const batchId = String(req.params.batchId || '').trim();
      const goOptions = { goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl, now: options.now };
      const loaded = await v11JSONRequest({ ...account, method: 'GET', pathname: `${V11_BASE}/batches/${encodeURIComponent(batchId)}`, ...goOptions });
      const batch = loaded?.batch || loaded;
      if (!batch?.id) return res.status(404).json({ error: '批量工程不存在' });
      const createStore = options.workshopStoreFactory || createMySQLWorkshopStore;
      const store = createStore({ targetBaseUrl: options.targetBaseUrl, bridgeSecret: options.bridgeSecret, account });
      const results = [];
      for (const book of Array.isArray(batch.books) ? batch.books : []) {
        const bookId = String(book?.id || '').trim();
        if (!bookId) continue;
        try {
          const result = await backfillBatchFactoryBook121Metadata({
            book,
            platforms: store.getPlatforms?.() || [],
            fetchDirectOriginal: input => store.fetchDirectOriginal(input),
            saveMetadata: payload => v11JSONRequest({
              ...account, method: 'PUT', pathname: `${V11_BASE}/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/metadata`, payload, ...goOptions
            })
          });
          results.push({ bookId, status: result.status });
        } catch (error) {
          results.push({ bookId, status: 'failed', error: String(error?.message || '121 元数据回填失败') });
        }
      }
      // Historical imports predate the original-fetch route's automatic AI
      // fallback. After 121 has supplied any deterministic category facts,
      // run that exact fallback for books whose gender/style remains missing.
      // The classifier re-reads each saved book, so a 121-derived gender is
      // authoritative while AI fills only the unresolved fields.
      const classifications = await classifyBatchFactoryBooks({
        books: batch.books,
        classifyBook: book => prepareBatchFactoryBookClassificationForRequest(req, { batchId, bookId: String(book.id) }, options)
      });
      const classificationByBookId = new Map(classifications.map(item => [String(item.bookId), item]));
      for (const result of results) {
        const classification = classificationByBookId.get(String(result.bookId));
        const { bookId: _bookId, ...classificationDetail } = classification || { status: 'skipped', reason: 'BOOK_NOT_FOUND' };
        result.classification = classificationDetail;
      }
      return res.json({ results });
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ error: error?.message || '121 元数据回填失败' });
    }
  });
  router.get('/batches/:batchId/runtime-summary', async (req, res) => {
    const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
    const batchId = String(req.params.batchId || '').trim();
    const cacheKey = `${account.username}:${batchId}`;
    const now = Date.now();
    // 批量状态页会长时间停留；只保留仍有效的短缓存，避免账户/批量组合无限累积。
    for (const [key, value] of runtimeSummaryCache) {
      if (!value || Number(value.expiresAt || 0) <= now) runtimeSummaryCache.delete(key);
    }
    const cached = runtimeSummaryCache.get(cacheKey);
    if (cached?.expiresAt > now) {
      try { return res.json(await cached.promise); }
      catch (error) { runtimeSummaryCache.delete(cacheKey); return res.status(Number(error?.status) || 502).json({ error: error?.message || '读取批量运行状态失败' }); }
    }
    const goOptions = { goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl, now: options.now };
    const request = async pathname => v11JSONRequest({ ...account, method: 'GET', pathname, ...goOptions });
    const promise = (async () => {
      const loaded = await request(batchFactoryRuntimeIndexPath(batchId));
      const batch = loaded?.batch || loaded;
      if (!batch?.id) {
        const error = new Error('批量工程不存在');
        error.status = 404;
        throw error;
      }
      return buildBatchFactoryRuntimeSummary({
        batch,
        automation: legacy.automationController?.status({ owner: account.username, batchId }),
        loadProduction: () => request(`${V11_BASE}/batches/${encodeURIComponent(batchId)}/status`),
        loadMerge: async () => {
          try { return await request(`${V11_BASE}/batches/${encodeURIComponent(batchId)}/merge-status`); }
          catch (error) { if (Number(error?.status) === 404) return { jobs: [] }; throw error; }
        },
        loadStageSummary: async bookId => {
          const result = await request(`${V11_BASE}/batches/${encodeURIComponent(batchId)}/books/${encodeURIComponent(bookId)}/stages`);
          return result?.summary || result;
        }
      });
    })();
    runtimeSummaryCache.set(cacheKey, { expiresAt: now + runtimeSummaryTTL, promise });
    try { return res.json(await promise); }
    catch (error) {
      runtimeSummaryCache.delete(cacheKey);
      return res.status(Number(error?.status) || 502).json({ error: error?.message || '读取批量运行状态失败' });
    }
  });
  router.put(['/batches/:batchId/settings', '/batches/:batchId/books/:bookId/override'], async (req, res) => {
    try {
      validateBatchFactoryModelPatch({ ...options, username: req.username, account: req.auth?.account, patch: req.body?.patch });
      const result = await v11JSONRequest({
        ...options, username: req.username, isOwner: req.auth?.account?.isOwner === true,
        method: 'PUT', pathname: rewriteV12PathForLegacyRead(new URL(req.originalUrl, 'http://qiantie.local').pathname), payload: req.body
      });
      res.setHeader('X-Batch-Factory-Version', 'v12');
      return res.json(redactBatchFactorySystemPromptBodies(result));
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({ error: error?.message || '保存批量工厂配置失败', code: error?.code || 'BFV11_UPSTREAM_UNAVAILABLE' });
    }
  });
	// Deletion is owner-scoped and removes only local records; no 121 or provider call runs.
	router.delete('/batches/:batchId/books/:bookId', async (req, res) => {
		try {
		const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
			const retentionDays = deletionRetentionDays(options, account.username);
			await v11JSONRequest({ ...account, method: 'DELETE', pathname: `${V11_BASE}/batches/${encodeURIComponent(req.params.batchId)}/books/${encodeURIComponent(req.params.bookId)}?retentionDays=${retentionDays}`, goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl });
			await legacy.automationController?.removeBook({ owner: account.username, batchId: String(req.params.batchId), bookId: String(req.params.bookId) });
			return res.status(204).end();
		} catch (error) { return res.status(Number(error?.status) || 400).json({ error: error?.message || '删除小说失败' }); }
	});
	router.delete('/batches/:batchId', async (req, res) => {
		try {
			const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
			const retentionDays = deletionRetentionDays(options, account.username);
			await v11JSONRequest({ ...account, method: 'DELETE', pathname: `${V11_BASE}/batches/${encodeURIComponent(req.params.batchId)}?retentionDays=${retentionDays}`, goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl });
			await legacy.automationController?.removeBatch({ owner: account.username, batchId: String(req.params.batchId) });
			return res.status(204).end();
		} catch (error) { return res.status(Number(error?.status) || 400).json({ error: error?.message || '删除批量项目失败' }); }
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
  router.automationController = legacy.automationController;
  return router;
}

module.exports = {
  V12_BASE,
  batchFactoryBatchListSummary,
  classifyBatchFactoryBooks,
  cleanBatchFactorySourceText,
  fetchBatchFactoryOriginals,
  buildGiantBatchCreatePayload,
  refillMissingBatchFactoryBookSource,
  buildBatchFactoryRuntimeSummary,
  batchFactoryRuntimeIndexPath,
  isNativeV12H3Path,
	  isV12DeletionPath,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
};
