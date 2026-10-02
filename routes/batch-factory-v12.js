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
const { createAutomationPresetStore } = require('../lib/batch-factory-v11/automation-presets');

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
  return {
    id: String(batch?.id || ''),
    title: String(batch?.title || ''),
    createdAt: batch?.createdAt,
    updatedAt: batch?.updatedAt,
    revision: Number(batch?.revision || 0),
    bookCount: books.length,
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

// Some book cities return a transient page-state line (for example "修改中")
// before the actual novel text. Keep the upstream response separately for
// audit/recovery, but never let browser placeholders enter AI production.
function normalizedBatchFactorySourceLine(value) {
  return String(value || '')
    .replace(/&nbsp;|\u00a0|　/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function isBatchFactoryLeadingPageStateLine(value) {
  return /^(?:修改中|加载中|正文加载中|请稍候)$/.test(value);
}

function isBatchFactoryPunctuationOnlyLine(value) {
  return /^[，。！？、；：…·—～~,.!?;:()（）【】\[\]{}「」『』“”"'\-]+$/.test(value);
}

function cleanBatchFactorySourceText(value) {
  const lines = String(value || '').split(/\r?\n/).map(normalizedBatchFactorySourceLine).filter(Boolean);
  let firstContent = 0;
  while (firstContent < lines.length && isBatchFactoryLeadingPageStateLine(lines[firstContent])) firstContent += 1;
  return lines.slice(firstContent).filter(line => !isBatchFactoryPunctuationOnlyLine(line)).join('\n');
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

// 巨量素材占位书的 platform 存的是青语显示名（"七猫"，多平台时"七猫 / 番茄"），
// 而上游拉正文接口只认数字书城 ID。这里把显示名解析回数字 ID：
// 数字原样通过 → 精确名匹配 → 去掉"/"后半段做唯一前缀匹配（"七猫"→"七猫付费"）。
// 解析不出来就原样返回，走原有报错路径，不猜。
function resolveWorkshopPlatformId(raw, platforms = []) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const list = (Array.isArray(platforms) ? platforms : []).filter(item => String(item?.id || '').trim() && String(item?.name || '').trim());
  if (list.some(item => String(item.id) === value)) return value;
  const short = value.split('/')[0].trim();
  const exact = list.find(item => String(item.name) === short);
  if (exact) return String(exact.id);
  const matches = list.filter(item => String(item.name).startsWith(short) && short);
  return matches.length === 1 ? String(matches[0].id) : value;
}

// Repairs only legacy/manual intake records where the source was never saved.
// The Go store enforces the same fill-only rule atomically so retries cannot
// replace a real source fetched by someone else.
async function refillMissingBatchFactoryBookSource({ book, fetchDirectOriginal, captureSource, platforms = [], now = () => new Date() } = {}) {
  if (String(book?.sourceText || '').trim()) throw new Error('当前书已有正文，不能覆盖');
  const rawBookID = String(book?.bookId || '').trim();
  // Older smart-input rows occasionally persisted "Book ID + title" in the
  // bookId field. The source ID is the leading transport-safe token; retaining
  // the title in that malformed field must not make the saved book impossible
  // to repair.
  const bookId = rawBookID.match(/^[A-Za-z0-9_.-]+/)?.[0] || '';
  const rawPlatform = String(book?.platform || book?.sourceMetadata?.platformId || '').trim();
  const platformId = resolveWorkshopPlatformId(rawPlatform, platforms);
  const maxTxt = Number(book?.sourceMetadata?.contentCaptureCharacters || 4000);
  if (!bookId || !platformId || !Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) throw new Error('当前书缺少可用的书城、Book ID 或正文范围');
  const fetched = await fetchDirectOriginal({ bookId, platformId, maxTxt });
  const rawSourceText = String(fetched?.rawText || fetched?.text || '').trim();
  const sourceText = cleanBatchFactorySourceText(fetched?.text || '');
  if (!sourceText) throw new Error('没有返回正文');
  const existingMetadata = book?.sourceMetadata && typeof book.sourceMetadata === 'object'
    ? book.sourceMetadata
    : {};
  const isGiantMaterial = existingMetadata.sourceMode === 'giant_material';
  const response = await captureSource({
    sourceText,
    expectedRevision: Number(book?.revision || 0),
    sourceMetadata: {
      ...existingMetadata,
      sourceMode: isGiantMaterial ? 'giant_material' : 'manual_refetched',
      sourceFetchedAt: now().toISOString(),
      sourceFetchAttempts: Number(fetched?.attempts || 0),
      sourceCaptureCharacters: maxTxt,
      sourceBookId: bookId,
      sourceOriginalRaw: rawSourceText,
      ...(isGiantMaterial ? {
        originalReadStage: 'completed',
        originalReadVia: 'bookstore',
        originalReadError: '',
        contentPending: false
      } : {}),
      ...(fetched?.bookinfo?.work_title ? { sourceBookTitle: String(fetched.bookinfo.work_title) } : {})
    }
  });
  return { ...response, fetched: { length: sourceText.length, attempts: fetched?.attempts || 0, bookinfo: fetched?.bookinfo || {} } };
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

function createBatchFactoryV12Router(options = {}) {
  const automationPresetStore = options.automationPresetStore || createAutomationPresetStore({ statePath: options.automationPresetStatePath });
  const legacy = createBatchFactoryV11Router({ ...options, automationPresetStore });
  const router = express.Router();
  const runtimeSummaryCache = new Map();
  const runtimeSummaryTTL = 4_000;
  router.get('/batches/summary', async (req, res) => {
    try {
      const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
      const result = await v11JSONRequest({
        ...account,
        method: 'GET',
        pathname: `${V11_BASE}/batches`,
        goBaseUrl: options.goBaseUrl,
        bridgeSecret: options.bridgeSecret
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
      const loaded = await request(`${V11_BASE}/batches/${encodeURIComponent(batchId)}`);
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
			await v11JSONRequest({ ...account, method: 'DELETE', pathname: `${V11_BASE}/batches/${encodeURIComponent(req.params.batchId)}/books/${encodeURIComponent(req.params.bookId)}`, goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl });
			await legacy.automationController?.removeBook({ owner: account.username, batchId: String(req.params.batchId), bookId: String(req.params.bookId) });
			return res.status(204).end();
		} catch (error) { return res.status(Number(error?.status) || 400).json({ error: error?.message || '删除小说失败' }); }
	});
	router.delete('/batches/:batchId', async (req, res) => {
		try {
			const account = { username: req.username, isOwner: req.auth?.account?.isOwner === true };
			await v11JSONRequest({ ...account, method: 'DELETE', pathname: `${V11_BASE}/batches/${encodeURIComponent(req.params.batchId)}`, goBaseUrl: options.goBaseUrl, bridgeSecret: options.bridgeSecret, fetchImpl: options.fetchImpl });
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
  isNativeV12H3Path,
	  isV12DeletionPath,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
};
