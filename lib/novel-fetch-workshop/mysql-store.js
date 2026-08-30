const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const DEFAULT_CONFIG = {
  workflow: {
    auto_classify_missing: true,
    auto_fetch_original: true,
    auto_rewrite_after_fetch: true,
    // 对外网站提交必须由用户明确开启，不能因为一次普通改文就自动写入第三方网站。
    auto_submit_after_rewrite: false,
    auto_submit_confirmed: false,
  },
  fetch: { endpoint: 'https://txt.121w.com/api.php', default_max_txt: 4000, timeout_seconds: 30, concurrency: 4, retries: 1, auto_detect_platform: true },
  ai: { base_url: '', api_key: '', model: '', timeout_seconds: 180, max_concurrency: 6, retry_times: 2, max_tokens: 1200, temperature: 0.45, top_p: 0.9, stream: false, json_mode: false, enable_thinking: false, disable_thinking: false, extra_body_json: '' },
  ai_presets: [],
  ai_assignments: { classifier: '__current__', rewrite: '__current__', sensitive_fix: '__current__' },
  rewrite: { default_ai_count: 1, max_ai_count: 5, process_line_count: 5, anchor_line_count: 5, temperature: 0.45, strategy: 'instruction', method_sequence: ['high_imitation', 'opening_instruction', 'instruction'], prompt: '你是短视频小说正文改写师。请只根据原文、风格类型和男女频改写开头部分，保留故事事实、人物关系、时代背景和后续衔接。输出正文，不要解释。' },
  parser: { default_parse_mode: 'smart', default_column_preset_id: 'sample_input', custom_column_order: '书籍ID,书名,推荐理由,男女频,标签,评级' }
};

const META_DEFAULTS = {
  bookId: '', bookName: '', paidBookId: '', freeBookId: '', platformId: '', platformName: '', gender: '', genderSource: '', style: '', styleSource: '', tags: '', reason: '', rating: '', sourceLine: '', parseMode: '', parseColumns: [], maxTxt: 4000, aiCount: 1, classifyStatus: '', classifyError: '', classifyConfidence: null, classifyReason: '', classifierModel: '', status: 'created', originalStatus: '', originalChars: 0, originalRawChars: 0, aiStatus: '', aiGeneratedCount: 0, aiError: '', error: '', createdAt: '', updatedAt: ''
};

const STYLES = ['古风虐文', '古风甜文', '古风通用', '年代虐文', '年代甜文', '年代通用', '现代虐文', '现代甜文', '现代悬疑', '现代通用', '男频都市', '现代女主', '玄幻', '历史', '爆款BGM', '家庭奇葩', '家庭伤感', '职场打脸'];
const PLATFORMS = [{ id: '1', name: '黑岩付费' }, { id: '2', name: '番茄付费' }, { id: '3', name: '七猫付费' }, { id: '4', name: '点众付费' }, { id: '7', name: '番茄免费' }, { id: '15', name: '知乎付费' }, { id: '20', name: '掌阅付费' }, { id: '26', name: '卓越付费' }, { id: '29', name: '九州书城' }, { id: '31', name: '掌文付费' }];
const BOOK_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_FETCH_ENDPOINT = 'https://txt.121w.com/api.php';

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function hasValue(value) { return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== ''); }
function normalizeNewlines(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function dropEmptyLines(text) { return String(text || '').split('\n').filter(line => line.trim() !== '').join('\n'); }
function cleanText(text) { return dropEmptyLines(normalizeNewlines(text)); }
function deepMerge(...objects) {
  const result = {};
  for (const source of objects) for (const [key, value] of Object.entries(source || {})) result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key], value) : value;
  return result;
}
function now() { return new Date().toISOString(); }
function assertBookID(bookId) {
  const value = String(bookId || '').trim();
  if (!BOOK_ID_PATTERN.test(value)) throw new Error('非法的书籍ID：' + value);
  return value;
}
function sign(secret, { username, isOwner, issuedAt, method, pathname }) {
  return crypto.createHmac('sha256', secret).update([username, issuedAt, String(isOwner), method, pathname].join('\n')).digest('hex');
}

function buildFetchURL(endpoint, { bookId, platformId, maxTxt }) {
  const template = String(endpoint || DEFAULT_FETCH_ENDPOINT).trim() || DEFAULT_FETCH_ENDPOINT;
  const variables = { bookid: String(bookId), platform: String(platformId), max_txt: String(maxTxt) };
  const substituted = template.replace(/\{(bookid|platform|max_txt)\}/g, (_, key) => encodeURIComponent(variables[key]));
  const url = new URL(substituted);
  // 模板模式让接入方自行决定参数名；普通 URL 则保持既有 121w 参数兼容。
  if (!/\{(?:bookid|platform|max_txt)\}/.test(template)) {
    if (!url.searchParams.has('bookid')) url.searchParams.set('bookid', variables.bookid);
    if (!url.searchParams.has('platform')) url.searchParams.set('platform', variables.platform);
    if (!url.searchParams.has('max_txt')) url.searchParams.set('max_txt', variables.max_txt);
  }
  return url.toString();
}

function extractFetchedText(response) {
  const payload = isPlainObject(response) ? response : {};
  const candidates = [payload.text, payload.data, payload.content, payload.data?.text, payload.data?.content];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

function upstreamFetchError(response) {
  const payload = isPlainObject(response) ? response : {};
  if (Number(payload.code) >= 400) {
    const error = new Error(payload.msg || `上游抓取失败（${payload.code}）`);
    error.upstream = true;
    return error;
  }
  return null;
}

function createMySQLWorkshopStore({ targetBaseUrl, bridgeSecret, account, fetchUpstream } = {}) {
  if (!account?.username) throw new Error('当前登录账号不可用');
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;

  function request(method, pathname, payload) {
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path: pathname, timeout: 30_000, headers: {
        Accept: 'application/json',
        'X-Qiantie-Username': account.username,
        'X-Qiantie-Is-Owner': String(account.isOwner === true),
        'X-Qiantie-Issued-At': issuedAt,
        'X-Qiantie-Signature': sign(secret, { username: account.username, isOwner: account.isOwner === true, issuedAt, method, pathname }),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {})
      } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = {};
          try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
          if ((response.statusCode || 500) >= 400) {
            const error = new Error(parsed.error || `小说获取工作台服务返回 ${response.statusCode}`);
            error.status = response.statusCode || 503;
            reject(error);
            return;
          }
          resolve(parsed);
        });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('小说获取工作台服务响应超时')));
      upstream.on('error', () => reject(Object.assign(new Error('小说获取工作台服务暂不可用，请稍后重试'), { status: 503 })));
      if (body) upstream.write(body);
      upstream.end();
    });
  }

  function pathFor(bookId) { return `/api/novel-fetch-workshop/tasks/${encodeURIComponent(assertBookID(bookId))}`; }
  async function readDocument(bookId) {
    const record = await request('GET', pathFor(bookId));
    return { bookId: record.bookId, meta: isPlainObject(record.meta) ? record.meta : {}, original: record.original || '', originalRaw: record.originalRaw || '', versions: isPlainObject(record.versions) ? record.versions : {}, logs: Array.isArray(record.logs) ? record.logs : [] };
  }
  async function writeDocument(document) {
    await request('PUT', pathFor(document.bookId), { meta: document.meta || {}, original: document.original || '', originalRaw: document.originalRaw || '', versions: document.versions || {}, logs: document.logs || [] });
  }
  async function existingOrNew(bookId) {
    try { return await readDocument(bookId); } catch (error) { if (error.status === 404) return { bookId, meta: {}, original: '', originalRaw: '', versions: {}, logs: [] }; throw error; }
  }
  async function appendLog(username, bookId, event, data) {
    const document = await existingOrNew(assertBookID(bookId));
    document.logs.push({ time: now(), event, data: isPlainObject(data) ? data : {} });
    await writeDocument(document);
  }
  async function updateTaskMeta(username, bookId, patch) {
    const document = await readDocument(assertBookID(bookId));
    document.meta = { ...document.meta, ...(isPlainObject(patch) ? patch : {}), updatedAt: now() };
    await writeDocument(document);
    return document.meta;
  }
  async function getTask(username, bookId) {
    try {
      const document = await readDocument(assertBookID(bookId));
      return { meta: document.meta, hasOriginalRaw: Boolean(document.originalRaw), document };
    } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function listTasks(username) {
    const response = await request('GET', '/api/novel-fetch-workshop/tasks');
    return (response.tasks || []).map(record => ({ ...record.meta, bookId: record.bookId, hasOriginal: Boolean(record.original), hasOriginalRaw: Boolean(record.originalRaw), hasAi: Object.keys(record.versions || {}).some(key => /^ai\d+$/.test(key)), updatedAt: record.updatedAt || record.meta?.updatedAt || '' }));
  }
  async function saveTasks(username, tasks) {
    let saved = 0;
    const merged = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (!isPlainObject(task) || !String(task.bookId || '').trim()) continue;
      const bookId = assertBookID(task.bookId);
      merged.set(bookId, { ...(merged.get(bookId) || {}), ...Object.fromEntries(Object.entries(task).filter(([, value]) => hasValue(value))) });
    }
    for (const [bookId, task] of merged) {
      const document = await existingOrNew(bookId);
      const meta = { ...META_DEFAULTS, ...document.meta };
      for (const [key, value] of Object.entries(task)) if (key !== 'bookId' && hasValue(value)) meta[key] = value;
      meta.bookId = bookId;
      meta.createdAt = meta.createdAt || now();
      meta.updatedAt = now();
      document.meta = meta;
      document.logs.push({ time: now(), event: 'task_saved', data: { bookId, bookName: meta.bookName || '' } });
      await writeDocument(document);
      saved++;
    }
    return { saved, duplicates: Math.max(0, (Array.isArray(tasks) ? tasks.length : 0) - merged.size) };
  }
  async function fetchOriginal(username, bookId, maxTxt) {
    const document = await readDocument(assertBookID(bookId));
    try {
      const configured = (await request('GET', '/api/novel-fetch-workshop/config')).settings || {};
      const fetchConfig = isPlainObject(configured.fetch) ? configured.fetch : {};
      const endpoint = fetchConfig.endpoint || DEFAULT_FETCH_ENDPOINT;
      const requestedPlatform = String(document.meta.platformId || '').trim();
      const candidates = [requestedPlatform, ...(fetchConfig.auto_detect_platform === false
        ? []
        : PLATFORMS.map(item => item.id).filter(id => id !== requestedPlatform))].filter(Boolean);
      const timeoutMs = Math.max(1, Number(fetchConfig.timeout_seconds) || 30) * 1000;
      const retryCount = Math.max(0, Math.floor(Number(fetchConfig.retries) || 0));
      const fetchCandidate = async platformId => {
        let lastError = null;
        for (let attempt = 0; attempt <= retryCount; attempt++) {
          try {
            if (fetchUpstream) return await fetchUpstream(document.bookId, platformId, maxTxt);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const result = await fetch(buildFetchURL(endpoint, { bookId: document.bookId, platformId, maxTxt }), { signal: controller.signal });
              if (!result.ok) {
                const error = new Error(`上游抓取失败（HTTP ${result.status}）`);
                error.upstream = true;
                throw error;
              }
              return await result.json();
            } finally {
              clearTimeout(timer);
            }
          } catch (error) {
            lastError = error;
            if (attempt < retryCount) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
          }
        }
        if (lastError?.name === 'AbortError') {
          const error = new Error(`原文抓取超时（${Math.floor(timeoutMs / 1000)} 秒）`);
          error.upstream = false;
          throw error;
        }
        throw lastError;
      };
      let response = null;
      let resolvedPlatform = requestedPlatform;
      let lastError = null;

      for (const platformId of candidates) {
        try {
          const candidate = await fetchCandidate(platformId);
          const upstreamError = upstreamFetchError(candidate);
          if (upstreamError) throw upstreamError;
          if (!extractFetchedText(candidate)) {
            const error = new Error('上游未返回正文内容');
            error.upstream = true;
            throw error;
          }
          response = candidate;
          resolvedPlatform = platformId;
          break;
        } catch (error) {
          lastError = error;
          // 只有上游明确表示「该平台无书/无正文」时才切换平台。
          // 网络、鉴权和地址配置问题不应被重复请求十次，避免让用户等待更久。
          if (!error?.upstream) break;
        }
      }

      if (!response) throw lastError || new Error('未获取到原文内容');
      const raw = extractFetchedText(response);
      document.originalRaw = raw;
      document.original = cleanText(raw);
      const resolved = PLATFORMS.find(item => item.id === resolvedPlatform);
      document.meta = {
        ...document.meta,
        ...(resolvedPlatform && resolvedPlatform !== requestedPlatform ? { platformId: resolvedPlatform, platformName: resolved?.name || document.meta.platformName, platformAutoDetected: true } : {}),
        originalStatus: 'done', originalRawChars: raw.length, originalChars: document.original.length,
        originalFetchedAt: now(), originalProcessedAt: now(), status: 'original_done',
        bookinfo: response?.bookinfo || document.meta.bookinfo, updatedAt: now()
      };
      if (!document.meta.bookName && response?.bookinfo?.book_name) document.meta.bookName = String(response.bookinfo.book_name);
      document.logs.push({ time: now(), event: 'original_fetched', data: { bookId: document.bookId, originalChars: document.original.length, requestedPlatform, resolvedPlatform, platformAutoDetected: resolvedPlatform !== requestedPlatform, timeoutSeconds: Math.floor(timeoutMs / 1000), retries: retryCount } });
      await writeDocument(document);
      return { status: 'done' };
    } catch (error) {
      document.meta = { ...document.meta, originalStatus: 'failed', status: 'original_failed', error: error.message || String(error), updatedAt: now() };
      document.logs.push({ time: now(), event: 'original_fetch_failed', data: { bookId: document.bookId, error: document.meta.error } });
      await writeDocument(document);
      return { status: 'failed' };
    }
  }
  async function readOriginal(username, bookId) { return (await readDocument(assertBookID(bookId))).original; }
  async function saveOriginalText(username, bookId, text) {
    const document = await readDocument(assertBookID(bookId));
    document.original = String(text || '');
    document.meta = { ...document.meta, originalChars: document.original.length, originalProcessedAt: now(), updatedAt: now() };
    document.logs.push({ time: now(), event: 'original_rules_applied', data: { bookId: document.bookId, originalChars: document.original.length } });
    await writeDocument(document);
  }
  async function restoreOriginal(username, bookId) {
    const document = await readDocument(assertBookID(bookId));
    if (!document.originalRaw) throw new Error('没有可恢复的原始备份');
    document.original = cleanText(document.originalRaw);
    document.meta = { ...document.meta, originalChars: document.original.length, originalProcessedAt: now(), status: 'original_restored', updatedAt: now() };
    document.logs.push({ time: now(), event: 'original_restored', data: { bookId: document.bookId, originalChars: document.original.length } });
    await writeDocument(document);
    return { status: 'original_restored', originalChars: document.original.length };
  }
  async function readLogs(username, bookId) { return (await readDocument(assertBookID(bookId))).logs; }
  async function readVersionText(username, bookId, version) { const document = await readDocument(assertBookID(bookId)); return version === 'original' || version === 'edited' ? document.original : (document.versions[version] || ''); }
  async function saveVersionText(username, bookId, version, text) { const document = await readDocument(assertBookID(bookId)); document.versions[version] = String(text || ''); await writeDocument(document); }
  async function deleteTasks(username, ids) { const response = await request('DELETE', '/api/novel-fetch-workshop/tasks', { ids: Array.isArray(ids) ? ids.map(assertBookID) : [] }); return response; }
  async function appendSiteSubmitLog(username, bookId, entry) { await appendLog(username, assertBookID(bookId), 'site_submit', entry); return entry; }
  async function readSiteSubmitLog(username, bookId) { return (await readLogs(username, assertBookID(bookId))).filter(item => item && item.event === 'site_submit').map(item => item.data || {}); }
  async function readSiteSubmitResult(username, bookId) { const rows = await readSiteSubmitLog(username, bookId); return rows.length ? rows[rows.length - 1] : {}; }

  return {
    getConfig: async () => deepMerge(DEFAULT_CONFIG, (await request('GET', '/api/novel-fetch-workshop/config')).settings || {}),
    saveConfig: async settings => request('PUT', '/api/novel-fetch-workshop/config', { settings: deepMerge(DEFAULT_CONFIG, settings || {}) }),
    getPlatforms: () => PLATFORMS,
    getStyles: () => STYLES,
    saveTasks, listTasks, getTask, updateTaskMeta, fetchOriginal, readOriginal, saveOriginalText, restoreOriginal, readLogs, readVersionText, saveVersionText, appendLog, appendSiteSubmitLog, readSiteSubmitLog, readSiteSubmitResult, deleteTasks
  };
}

module.exports = { createMySQLWorkshopStore, DEFAULT_CONFIG, DEFAULT_FETCH_ENDPOINT, buildFetchURL, extractFetchedText, upstreamFetchError, normalizeNewlines, dropEmptyLines, cleanText };
