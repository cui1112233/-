// 改文工作台：任务数据层（任务状态机 + 文件落盘）
// 提供任务元信息（meta）、原始原文备份（original_raw）、处理后原文（original）、
// 各版本 AI 改文（ai/aiN）、事件日志（logs）与任务列表索引（index）的读写。
// 抓原文使用注入的 fetchUpstream（可测），未注入时使用默认实现（GET txt.121w.com）。
// 落盘复用 ../system-store 的 readJsonOrMissing / writeJsonAtomic / withJsonLock。
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');
const { fetchWithPolicy } = require('./fetch-policy');

// 上游抓取接口（默认实现）：GET https://txt.121w.com/api.php?bookid=..&platform=..&max_txt=..
const UPSTREAM_URL = 'https://txt.121w.com/api.php';
const REQUEST_TIMEOUT_MS = 20000;

// 默认 fetchUpstream：注入缺失时使用；返回 { text, bookinfo }
function defaultFetchUpstream(bookId, platformId, maxTxt, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${UPSTREAM_URL}?bookid=${encodeURIComponent(bookId)}&platform=${encodeURIComponent(platformId)}&max_txt=${encodeURIComponent(maxTxt)}`;
    const req = https.get(url, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // 上游返回 { code, msg, data }，正文在 data 字段；code !== 200 时无正文
          const text = parsed && parsed.code === 200 && typeof parsed.data === 'string' ? parsed.data : '';
          resolve({ code: parsed && parsed.code, msg: parsed && parsed.msg, text, bookinfo: parsed && parsed.bookinfo });
        } catch (_) {
          const error = new Error('上游返回非 JSON 数据');
          error.code = 'UPSTREAM_INVALID_JSON';
          error.recoverable = true;
          reject(error);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
    req.setTimeout(timeoutMs, () => {
      const error = new Error(`上游请求超时（${Math.floor(timeoutMs / 1000)} 秒）`);
      error.code = 'UPSTREAM_TIMEOUT';
      error.recoverable = true;
      req.destroy(error);
    });
  });
}

// ===== 基础清洗（一期）：换行归一化 + 可选去空行 =====
// \r\n / \r 统一转 \n
function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// 删除空行（trim 后为空的行）
function dropEmptyLines(text) {
  return String(text || '').split('\n').filter(line => line.trim() !== '').join('\n');
}

// 基础清洗组合：先归一化换行，再去空行（当前一期固定执行）
function cleanText(text) {
  return dropEmptyLines(normalizeNewlines(text));
}

// meta 初始默认值（字段 camelCase，对比配置键 snake_case）
const META_DEFAULTS = {
  bookId: '',
  bookName: '',
  paidBookId: '',
  freeBookId: '',
  platformId: '',
  platformName: '',
  gender: '',
  genderSource: '',
  style: '',
  styleSource: '',
  tags: '',
  reason: '',
  rating: '',
  sourceLine: '',
  parseMode: '',
  parseColumns: [],
  maxTxt: 4000,
  aiCount: 1,
  classifyStatus: '',
  classifyError: '',
  classifyConfidence: null,
  classifyReason: '',
  classifierModel: '',
  status: 'created',
  originalStatus: '',
  originalChars: 0,
  originalRawChars: 0,
  originalFetchAttempts: 0,
  originalErrorCode: '',
  sensitiveMode: 'disabled',
  sensitiveStatus: '',
  sensitiveHitCount: 0,
  sensitiveFixedCount: 0,
  aiStatus: '',
  aiGeneratedCount: 0,
  aiError: '',
  error: '',
  createdAt: '',
  updatedAt: ''
};

// 判断普通对象（排除数组 / null）
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 是否为非空值（string 去空白后 / 数字 / true / 数组等）
function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

// 本地时间 ISO 字符串（含时区偏移），如 2026-08-18T12:34:56+08:00
function isoLocalTime(date) {
  const pad = value => String(value).padStart(2, '0');
  const d = new Date(date);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ===== 安全删除：解析绝对路径后必须位于任务根目录内，否则拒绝 =====
function safeUnlink(filePath, rootDir) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`拒绝删除越界路径: ${resolved}`);
  }
  try {
    fs.unlinkSync(resolved);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

// 创建改文工作台任务数据层
// usersDir：用户数据根目录（例如 data/users）；fetchUpstream：注入的抓取函数（可测）
function createWorkshopTasks({ usersDir, fetchUpstream, fetchConfig = {}, rules, getLayout } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);
  const fetchOne = typeof fetchUpstream === 'function' ? fetchUpstream : defaultFetchUpstream;
  const layoutRules = rules || require('./rules');
  const resolveLayout = typeof getLayout === 'function' ? getLayout : () => ({});

  // 用户工作台任务目录：<usersDir>/<username>/novel-fetch-workshop/
  function dir(username) {
    if (typeof username !== 'string' || !username.trim()) throw new Error('无效用户名');
    return path.join(resolvedUsersDir, username, 'novel-fetch-workshop');
  }
  function metaPath(username, bookId) { return path.join(dir(username), 'meta', `${bookId}.json`); }
  function originalRawPath(username, bookId) { return path.join(dir(username), 'original_raw', `${bookId}.txt`); }
  function originalPath(username, bookId) { return path.join(dir(username), 'original', `${bookId}.txt`); }
  function logsPath(username, bookId) { return path.join(dir(username), 'logs', `${bookId}.jsonl`); }
  function indexPath(username) { return path.join(dir(username), 'index.json'); }
  function lockPath(username) { return path.join(dir(username), '.index.lock'); }

  function normalizeBookId(bookId) {
    const bid = String(bookId == null ? '' : bookId).trim();
    if (!bid) throw new Error('bookId is required');
    // 白名单校验：仅允许字母数字、下划线、点、连字符
    // 拒绝包含 .. / \ 盘符等可越出任务目录的路径穿越输入
    if (!/^[A-Za-z0-9_.-]+$/.test(bid)) throw new Error('非法的书籍ID：' + bid);
    return bid;
  }

  // ===== 读取 / 写入 meta =====
  function readMeta(username, bookId) {
    const result = readJsonOrMissing(metaPath(username, bookId));
    return result.found && isPlainObject(result.value) ? result.value : null;
  }

  // ===== 读取 / 写入 index（按 updatedAt 倒序）=====
  function readIndex(username) {
    const result = readJsonOrMissing(indexPath(username));
    return result.found && Array.isArray(result.value) ? result.value : [];
  }

  function writeIndex(username, books) {
    fs.mkdirSync(dir(username), { recursive: true });
    withJsonLock(lockPath(username), () => {
      writeJsonAtomic(indexPath(username), books);
    });
  }

  function upsertIndexEntry(username, meta) {
    const books = readIndex(username).filter(entry => entry && entry.bookId !== meta.bookId);
    books.push({
      bookId: meta.bookId,
      bookName: meta.bookName || '',
      platformName: meta.platformName || '',
      gender: meta.gender || '',
      style: meta.style || '',
      status: meta.status || '',
      originalStatus: meta.originalStatus || '',
      originalFetchAttempts: meta.originalFetchAttempts || 0,
      originalErrorCode: meta.originalErrorCode || '',
      aiGeneratedCount: meta.aiGeneratedCount || 0,
      maxTxt: meta.maxTxt || 0,
      updatedAt: meta.updatedAt
    });
    books.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    writeIndex(username, books);
  }

  // ===== 日志 =====
  function appendLog(username, bookId, event, data) {
    const bid = normalizeBookId(bookId);
    const logPath = logsPath(username, bid);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify({ time: isoLocalTime(new Date()), event, data: isPlainObject(data) ? data : {} });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  }

  function readLogs(username, bookId) {
    const bid = normalizeBookId(bookId);
    const logPath = logsPath(username, bid);
    const lines = [];
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        try {
          lines.push(JSON.parse(line));
        } catch (_) {
          // 跳过损坏行
        }
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    return lines;
  }

  function appendSiteSubmitLog(username, bookId, entry) {
    const result = isPlainObject(entry) ? entry : {};
    appendLog(username, bookId, 'site_submit', result);
    return result;
  }

  function readSiteSubmitLog(username, bookId) {
    return readLogs(username, bookId).filter(item => item && item.event === 'site_submit').map(item => item.data || {});
  }

  function readSiteSubmitResult(username, bookId) {
    const entries = readSiteSubmitLog(username, bookId);
    return entries.length ? entries[entries.length - 1] : {};
  }

  // ===== 读取原文 =====
  function readTextFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return '';
      throw error;
    }
  }

  function readOriginalRaw(username, bookId) {
    return readTextFile(originalRawPath(username, normalizeBookId(bookId)));
  }

  function readOriginal(username, bookId) {
    return readTextFile(originalPath(username, normalizeBookId(bookId)));
  }

  function saveOriginalText(username, bookId, text) {
    assertUsername(username);
    const bid = normalizeBookId(bookId);
    const meta = readMeta(username, bid);
    if (!meta) throw new Error('任务不存在，无法写入处理后原文');
    const value = String(text || '');
    fs.mkdirSync(path.dirname(originalPath(username, bid)), { recursive: true });
    fs.writeFileSync(originalPath(username, bid), value, 'utf8');
    meta.originalChars = value.length;
    meta.originalProcessedAt = new Date().toISOString();
    meta.updatedAt = meta.originalProcessedAt;
    writeJsonAtomic(metaPath(username, bid), meta);
    upsertIndexEntry(username, meta);
    appendLog(username, bid, 'original_rules_applied', { bookId: bid, originalChars: value.length });
  }

  // AI 版本绝对路径：ai/ai{n}/{bookId}.txt（供 rewrite.js 写文件）
  function pathForAiVersion(username, bookId, n) {
    return path.join(dir(username), 'ai', `ai${n}`, `${normalizeBookId(bookId)}.txt`);
  }

  // 读版本文本：version ∈ 'original' | 'edited' | 'ai1'..；'edited' 为 'original' 一期别名
  function readVersionText(username, bookId, version) {
    const bid = normalizeBookId(bookId);
    const v = String(version || '');
    if (v === 'original' || v === 'edited') return readOriginal(username, bid);
    const match = v.match(/^ai(\d+)$/);
    if (match) return readTextFile(pathForAiVersion(username, bid, Number(match[1])));
    return '';
  }

  // ===== 保存任务：按 bookId 合并去重（非空值补齐）落 meta，更新 index =====
  async function saveTasks(username, tasks) {
    assertUsername(username);
    if (!Array.isArray(tasks)) throw new Error('tasks must be an array');
    fs.mkdirSync(dir(username), { recursive: true });

    // 先按本次输入合并去重：后出现的非空值覆盖
    const merged = new Map();
    let duplicates = 0;
    for (const task of tasks) {
      if (!isPlainObject(task)) continue;
      const rawId = String(task.bookId == null ? '' : task.bookId).trim();
      if (!rawId) continue; // 空 bookId 跳过（保持原行为）
      const bookId = normalizeBookId(rawId); // 白名单校验：拒绝路径穿越
      if (merged.has(bookId)) {
        duplicates++;
        const current = merged.get(bookId);
        for (const [key, value] of Object.entries(task)) {
          if (hasValue(value)) current[key] = value;
        }
      } else {
        merged.set(bookId, { ...task });
      }
    }

    const now = new Date().toISOString();
    let saved = 0;
    for (const [bookId, task] of merged.entries()) {
      // 已有 meta 则在其上补齐（保留状态），否则用默认值新建
      const existing = readMeta(username, bookId);
      const meta = existing && isPlainObject(existing) ? { ...existing } : { ...META_DEFAULTS };
      for (const [key, value] of Object.entries(task)) {
        if (key === 'bookId') continue;
        if (hasValue(value) && Object.hasOwn(meta, key)) meta[key] = value;
      }
      meta.bookId = bookId;
      if (!meta.createdAt) meta.createdAt = existing && existing.createdAt ? existing.createdAt : now;
      meta.updatedAt = now;
      writeJsonAtomic(metaPath(username, bookId), meta);
      upsertIndexEntry(username, meta);
      appendLog(username, bookId, 'task_saved', { bookId, bookName: meta.bookName || '' });
      saved++;
    }
    return { saved, duplicates };
  }

  // ===== 任务列表：从 index 读，补 hasOriginal/hasAi 等存在性标记 =====
  function listTasks(username) {
    assertUsername(username);
    const result = [];
    for (const entry of readIndex(username)) {
      if (!isPlainObject(entry) || !entry.bookId) continue;
      // 白名单校验：index 中 bookId 不应含路径分隔符（防御手改 index.json 越界读）；
      // 单个非法条目（手改坏数据）只丢弃，不让它拖垮整个任务列表（500）。
      let bid;
      try {
        bid = normalizeBookId(entry.bookId);
      } catch (_) {
        continue;
      }
      result.push({
        ...entry,
        hasOriginal: fs.existsSync(originalPath(username, bid)),
        hasOriginalRaw: fs.existsSync(originalRawPath(username, bid)),
        hasAi: hasAnyAiVersion(username, bid)
      });
    }
    return result;
  }

  // 是否存在任意 ai/ai{n}/{bookId}.txt
  function hasAnyAiVersion(username, bookId) {
    const aiRoot = path.join(dir(username), 'ai');
    let entries;
    try {
      entries = fs.readdirSync(aiRoot, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^ai\d+$/.test(entry.name)) continue;
      if (fs.existsSync(path.join(aiRoot, entry.name, `${bookId}.txt`))) return true;
    }
    return false;
  }

  // ===== 任务详情：meta + 原始备份存在性 =====
  function getTask(username, bookId) {
    assertUsername(username);
    const bid = normalizeBookId(bookId);
    const meta = readMeta(username, bid);
    if (!meta) return null;
    return { meta, hasOriginalRaw: fs.existsSync(originalRawPath(username, bid)) };
  }

  // ===== 更新任务 meta：读现有 meta → 合并 patch → 写回 → 刷新 updatedAt =====
  // 供改文引擎（rewrite.js）在生成版本时增量更新 aiStatus/aiGeneratedCount/rewriteKnowledge 等字段。
  async function updateTaskMeta(username, bookId, patch) {
    assertUsername(username);
    const bid = normalizeBookId(bookId);
    const meta = readMeta(username, bid);
    if (!meta) throw new Error('任务不存在，无法更新 meta');
    const now = new Date().toISOString();
    Object.assign(meta, isPlainObject(patch) ? patch : {});
    meta.updatedAt = now;
    writeJsonAtomic(metaPath(username, bid), meta);
    upsertIndexEntry(username, meta);
    return meta;
  }

  // ===== 抓原文：抓取→存 raw→清洗→存 original→更新 meta→appendLog =====
  async function fetchOriginal(username, bookId, maxTxt) {
    assertUsername(username);
    const bid = normalizeBookId(bookId);
    const meta = readMeta(username, bid);
    if (!meta) throw new Error('任务不存在，无法抓取原文');
    const now = new Date().toISOString();

    let attempts = 0;
    try {
      const result = await fetchWithPolicy({
        bookId: bid,
        platformId: meta.platformId || '',
        maxTxt,
        fetchConfig,
        fetchUpstream: async (receivedBookId, platformId, requestedMaxTxt, options) => {
          const response = await fetchOne(receivedBookId, platformId, requestedMaxTxt, options);
          if (Number(response?.code) >= 400) {
            const error = new Error(response.msg || `上游抓取失败（${response.code}）`);
            error.code = 'UPSTREAM_FETCH_ERROR';
            error.recoverable = true;
            throw error;
          }
          return response;
        }
      });
      attempts = result.attempts;
      const raw = result && typeof result.text === 'string' ? result.text : '';
      if (!raw) throw new Error('未获取到原文内容');
      const cleaned = layoutRules.processDocumentText(cleanText(raw), 'original', resolveLayout());

      // 原始备份永不被覆盖，先写 raw 再写清洗后原文
      fs.mkdirSync(path.dirname(originalRawPath(username, bid)), { recursive: true });
      fs.writeFileSync(originalRawPath(username, bid), raw, 'utf8');
      fs.mkdirSync(path.dirname(originalPath(username, bid)), { recursive: true });
      fs.writeFileSync(originalPath(username, bid), cleaned, 'utf8');

      meta.originalStatus = 'done';
      meta.originalRawChars = raw.length;
      meta.originalChars = cleaned.length;
      meta.originalFetchAttempts = attempts;
      meta.originalErrorCode = '';
      meta.originalFetchedAt = now;
      meta.originalProcessedAt = now;
      meta.status = 'original_done';
      if (isPlainObject(result.bookinfo)) meta.bookinfo = result.bookinfo;
      if (!meta.bookName && isPlainObject(result.bookinfo) && result.bookinfo.book_name) {
        meta.bookName = String(result.bookinfo.book_name);
      }
      meta.updatedAt = now;
      writeJsonAtomic(metaPath(username, bid), meta);
      upsertIndexEntry(username, meta);
      appendLog(username, bid, 'original_fetched', {
        bookId: bid,
        originalRawChars: meta.originalRawChars,
        originalChars: meta.originalChars,
        attempts
      });
      return { status: 'done', attempts };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const attempted = Math.max(1, Number(error?.attempts) || attempts || 1);
      const code = typeof error?.code === 'string' && error.code.trim() ? error.code : 'ORIGINAL_FETCH_FAILED';
      meta.originalStatus = 'failed';
      meta.status = 'original_failed';
      meta.originalFetchAttempts = attempted;
      meta.originalErrorCode = code;
      meta.error = message;
      meta.updatedAt = now;
      writeJsonAtomic(metaPath(username, bid), meta);
      upsertIndexEntry(username, meta);
      appendLog(username, bid, 'original_fetch_failed', { bookId: bid, error: message, code, attempts: attempted });
      return { status: 'failed', attempts: attempted, code };
    }
  }

  // ===== 从原始备份恢复：读回 → 重新基础清洗 → 写回 original =====
  async function restoreOriginal(username, bookId) {
    assertUsername(username);
    const bid = normalizeBookId(bookId);
    const meta = readMeta(username, bid);
    if (!meta) throw new Error('任务不存在，无法恢复原文');
    const raw = readOriginalRaw(username, bid);
    if (!raw) throw new Error('原始备份不存在，无法恢复');
    const now = new Date().toISOString();

    const cleaned = layoutRules.processDocumentText(cleanText(raw), 'original', resolveLayout());
    fs.mkdirSync(path.dirname(originalPath(username, bid)), { recursive: true });
    fs.writeFileSync(originalPath(username, bid), cleaned, 'utf8');

    meta.originalChars = cleaned.length;
    meta.originalProcessedAt = now;
    meta.status = 'original_restored';
    meta.updatedAt = now;
    writeJsonAtomic(metaPath(username, bid), meta);
    upsertIndexEntry(username, meta);
    appendLog(username, bid, 'original_restored_from_backup', { bookId: bid, originalChars: cleaned.length });
    return { status: 'done' };
  }

  // ===== 删除任务：删除该书全部文件 + index 移除（safeUnlink 越界保护）=====
  function deleteTasks(username, bookIds) {
    assertUsername(username);
    if (!Array.isArray(bookIds)) throw new Error('bookIds must be an array');
    const taskRoot = dir(username);
    let deleted = 0;
    const results = [];
    for (const bookId of bookIds) {
      const rawId = String(bookId == null ? '' : bookId).trim();
      if (!rawId) continue; // 空 bookId 跳过（保持原行为）
      const bid = normalizeBookId(rawId); // 白名单校验：拒绝路径穿越
      const paths = [
        metaPath(username, bid),
        originalRawPath(username, bid),
        originalPath(username, bid),
        logsPath(username, bid)
      ];
      // ai 目录下所有 ai{n}/{bookId}.txt
      const aiRoot = path.join(taskRoot, 'ai');
      try {
        for (const entry of fs.readdirSync(aiRoot, { withFileTypes: true })) {
          if (entry.isDirectory() && /^ai\d+$/.test(entry.name)) {
            paths.push(path.join(aiRoot, entry.name, `${bid}.txt`));
          }
        }
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
      let removedAny = false;
      for (const filePath of paths) {
        if (safeUnlink(filePath, taskRoot)) removedAny = true;
      }
      // index 移除该书
      const books = readIndex(username).filter(entry => !entry || entry.bookId !== bid);
      if (books.length !== readIndex(username).length) {
        writeIndex(username, books);
        removedAny = true;
      }
      if (removedAny) deleted++;
      results.push({ bookId: bid, deleted: removedAny });
    }
    return { requested: bookIds.length, deleted, results };
  }

  function assertUsername(username) {
    if (typeof username !== 'string' || !username.trim()) throw new Error('无效用户名');
    return username;
  }

  return {
    saveTasks,
    listTasks,
    getTask,
    updateTaskMeta,
    fetchOriginal,
    readOriginalRaw,
    readOriginal,
    saveOriginalText,
    readVersionText,
    pathForAiVersion,
    appendLog,
    readLogs,
    appendSiteSubmitLog,
    readSiteSubmitLog,
    readSiteSubmitResult,
    deleteTasks,
    restoreOriginal
  };
}

module.exports = { createWorkshopTasks, normalizeNewlines, dropEmptyLines };
