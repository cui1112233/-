# 小说获取 → two.121w.com 自动上传 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「小说获取」页为 AI 处理（诱导排查/爆款优化）的小说新增一键批量上传至 two.121w.com：AI 逐本分析性别/风格 → 处理结果落盘 → 文档可查看/编辑 → 后端直连目标站逐本上传，每本使用自己的性别/风格。

**Architecture:** 后端新增 `lib/novel-fetch-store.js`（用户正文+元数据+目标站会话落盘）、`lib/target-upload.js`（目标站常量映射/multipart/HTTP 客户端）、`routes/novel-fetch-upload.js`（登录/会话/批量上传）；扩展 `routes/novel-fetch.js`（AI 分析解析、`/save`、`/saved`）；前端扩展 `NovelFetchPage.jsx`（编辑弹窗 + 对接上传面板）。上传接口**禁止返回 401**（避免前端 `client.js` 全局会话失效处理），改用 `200 + notLoggedIn:true`。

**Tech Stack:** Node.js + Express（后端）、`node:http`（目标站对接，不引第三方依赖）、React + Ant Design + lucide-react（前端）、node:test（测试）。

## Global Constraints

- 上传相关接口**禁止使用 401** 状态码；"目标站未登录/会话失效"用 `200 + { ok:false, notLoggedIn:true, error }`；登录失败用 `400`。
- 目标站为 HTTP：`http://two.121w.com`（登录 `login.php` GET 提交 username/password；上传 `api/zbooklist_upload.php` multipart）。
- 目标站字段常量（已实测）：平台 `1黑岩/2番茄/3七猫/4点众/6阅文/7番茄免费/15知乎/20掌阅/26卓越/29九州/31掌文`；性别 `1男/2女`；风格 `101古风虐文/102古风甜文/103古风通用/201年代虐文/202年代甜文/203年代通用/301现代虐文/302现代甜文/303现代悬疑/304现代通用/305男频都市/306现代女主/307玄幻/308历史/309爆款BGM/310家庭奇葩/311家庭伤感/312职场打脸`。
- 高级设置默认值：`tl5:0, ziti:1, zitidx:62, biaohong:'', keywords:'', biaohongReuse:'', jieyaNum:4, jieyaAiHead:0, jieyaSpeed:1.7, jieyaPitch:0, gunpingNum:4, gunpingSpeed:1, fontColorStyles:[1]`；解压语速 0.5–2.0、解压音调 -50–50、滚屏语速 0.1–2.0、数量 0–20。
- 本期不做背景音乐、不做 `jieya_ai_head=3`（自定义 AI 头部），提交时 `jieya_ai_head` 仅接受 0/1/2。
- 用户数据目录：`data/users/<用户名>/novel-fetch/`（正文 `<bookId>.txt` + 元数据 `<bookId>.meta.json` + 索引 `index.json`）；目标站会话 `data/users/<用户名>/upload-target.json`（仅存 cookie，不存账号密码）。
- 中文文案，代码注释中文。

---

### Task 1: 预设规则升级 + AI 分析解析（后端核心）

**Files:**
- Modify: `lib/system-preset-catalog.js`（`INDUCE_PRESET_BODY`、`HOOK_PRESET_BODY` 输出格式加「分析结果」节）
- Modify: `routes/novel-fetch.js`（新增 `extractAnalysis`；`splitReportAndText` 改为关键词匹配；`/process` 返回 `analysis`）
- Test: `tests/novel-fetch-analysis.test.js`

**Interfaces:**
- Produces: `extractAnalysis(content)` → `{ gender: '男'|'女'|null, style: string|null, rest: string }`（`rest` 为去掉分析节后的内容）；`splitReportAndText(content)`（关键词匹配，兼容"一二三四"任意序号）；`/process` 单本结果新增 `analysis: { gender, style } | null`。
- Consumes: 无（纯解析，独立可测）。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-analysis.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractAnalysis, splitReportAndText } = require('../routes/novel-fetch');

const STYLES = ['古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用','现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主','玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'];

test('extractAnalysis parses gender/style JSON and strips the section', () => {
  const content = '### 一、分析结果\n{"gender":"女","style":"现代虐文"}\n\n### 二、合规检测报告\n报告\n### 三、优化后全文\n正文内容';
  const { gender, style, rest } = extractAnalysis(content);
  assert.equal(gender, '女');
  assert.equal(style, '现代虐文');
  assert.ok(!rest.includes('分析结果'), 'rest must not contain analysis section');
  assert.ok(rest.includes('优化后全文'));
});

test('extractAnalysis returns nulls when no analysis section', () => {
  const { gender, style, rest } = extractAnalysis('纯文本');
  assert.equal(gender, null);
  assert.equal(style, null);
  assert.equal(rest, '纯文本');
});

test('extractAnalysis nulls invalid style and invalid gender', () => {
  const bad = '### 一、分析结果\n{"gender":"未知","style":"不存在的风格"}\n\n### 二、优化后全文\n正文';
  const { gender, style } = extractAnalysis(bad);
  assert.equal(gender, null);
  assert.equal(style, null);
});

test('splitReportAndText handles shifted numbering (分析结果占一节)', () => {
  const content = '### 二、合规检测报告\n报告\n### 三、优化后全文\n优化后正文\n### 四、关键修改说明\n改了';
  const { report, rest } = splitReportAndText(content);
  assert.equal(rest, '优化后正文');
  assert.ok(report.includes('合规检测报告'));
  assert.ok(report.includes('关键修改说明'));
});

test('splitReportAndText keyword match keeps legacy behavior', () => {
  const content = '### 一、优化说明\n说明\n### 二、优化后全文\n正文内容';
  assert.deepEqual(splitReportAndText(content), { report: '### 一、优化说明\n说明', rest: '正文内容' });
  assert.deepEqual(splitReportAndText('纯文本内容'), { report: '', rest: '纯文本内容' });
});

test('system preset seeds contain analysis section and all styles', () => {
  const catalog = fs.readFileSync(path.join(__dirname, '..', 'lib', 'system-preset-catalog.js'), 'utf8');
  assert.match(catalog, /分析结果/);
  for (const s of STYLES) {
    assert.ok(catalog.includes(s), `missing style: ${s}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-analysis.test.js`
Expected: FAIL（`extractAnalysis`/`splitReportAndText` 未导出或解析不对）。

- [ ] **Step 3: 升级预设（system-preset-catalog.js）**

在 `INDUCE_PRESET_BODY` 的「## 输出格式要求」下，把「### 一、合规检测报告」等节改名为「### 二、合规检测报告」「### 三、优化后全文」「### 四、关键修改说明（可选）」，并在最前面新增一节：

```js
### 一、分析结果
（先分析本书属于男频还是女频、适合哪种风格，仅用于系统自动配置，禁止写入正文；单独输出一行 JSON，不解释、不加代码块标记）
{"gender":"男" 或 "女","style":"从下面风格列表选择最合适的一个"}

风格列表：古风虐文、古风甜文、古风通用、年代虐文、年代甜文、年代通用、现代虐文、现代甜文、现代悬疑、现代通用、男频都市、现代女主、玄幻、历史、爆款BGM、家庭奇葩、家庭伤感、职场打脸
```

`HOOK_PRESET_BODY` 同样：新增「### 一、分析结果」（同文案），原「### 一、优化说明」「### 二、优化后全文」改为「### 二、优化说明」「### 三、优化后全文」。

- [ ] **Step 4: 实现 extractAnalysis 与 splitReportAndText**

在 `routes/novel-fetch.js` 中，把现有 `splitReportAndText`（约 95–111 行）整体替换为关键词匹配版本，并在其上方新增：

```js
const STYLE_NAMES = [
  '古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用',
  '现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主',
  '玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'
];

function extractAnalysis(content) {
  const text = String(content || '');
  const headerIndex = text.search(/(?:^|\n)#{1,3}\s*[一二三四五六]?\s*[、\s]*分析结果/);
  if (headerIndex === -1) return { gender: null, style: null, rest: text };
  const headerStart = headerIndex === 0 ? 0 : headerIndex + 1;
  const afterHeader = text.slice(headerStart);
  const nextSection = afterHeader.search(/\n#{1,3}\s*[一二三四五六]?\s*[、\s]*(合规检测报告|优化说明|优化后全文|关键修改说明)/);
  const sectionText = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);
  const jsonMatch = sectionText.match(/\{"gender"\s*:\s*"([^"]+)"\s*,\s*"style"\s*:\s*"([^"]+)"\}/);
  let gender = null;
  let style = null;
  if (jsonMatch) {
    if (jsonMatch[1] === '男' || jsonMatch[1] === '女') gender = jsonMatch[1];
    if (STYLE_NAMES.includes(jsonMatch[2])) style = jsonMatch[2];
  }
  const rest = nextSection === -1 ? text.slice(0, headerStart) : text.slice(0, headerStart) + afterHeader.slice(nextSection);
  return { gender, style, rest };
}
```

`splitReportAndText` 替换为：

```js
function splitReportAndText(content) {
  const text = String(content || '');
  const reportPattern = /^#{1,3}\s*[一二三四五六]?\s*[、\s]*(合规检测报告|优化说明)/m;
  const fullTextPattern = /^#{1,3}\s*[一二三四五六]?\s*[、\s]*优化后全文/m;
  const thirdPattern = /^#{1,3}\s*[一二三四五六]?\s*[、\s]*关键修改说明/m;

  const reportMatch = text.match(reportPattern);
  if (!reportMatch) return { report: '', rest: text };
  const reportIndex = reportMatch.index;

  const fullTextMatch = text.slice(reportIndex).match(fullTextPattern);
  if (!fullTextMatch) {
    return { report: text.slice(0, reportIndex).trim(), rest: text.slice(reportIndex).trim() };
  }
  const fullTextIndex = reportIndex + fullTextMatch.index;
  const afterFull = fullTextIndex + fullTextMatch[0].length;

  const thirdMatch = text.slice(afterFull).match(thirdPattern);
  if (!thirdMatch) {
    return { report: text.slice(0, fullTextIndex).trim(), rest: text.slice(afterFull).trim() };
  }
  const thirdIndex = afterFull + thirdMatch.index;
  const rest = text.slice(afterFull, thirdIndex).trim();
  const report = `${text.slice(0, fullTextIndex)}\n${text.slice(thirdIndex)}`.trim();
  return { report, rest };
}
```

- [ ] **Step 5: 导出 extractAnalysis 与 STYLE_NAMES**

在 `routes/novel-fetch.js` 末尾：

```js
module.exports = { createNovelFetchRouter, PLATFORMS, extractProcessContent, splitReportAndText, extractAnalysis, STYLE_NAMES, computeMaxTokens };
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/novel-fetch-analysis.test.js`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add lib/system-preset-catalog.js routes/novel-fetch.js tests/novel-fetch-analysis.test.js
git commit -m "feat: add per-book gender/style AI analysis to novel fetch presets"
```

---

### Task 2: novel-fetch 落盘存储（store）

**Files:**
- Create: `lib/novel-fetch-store.js`
- Test: `tests/novel-fetch-store.test.js`

**Interfaces:**
- Produces: `createNovelFetchStore({ usersDir })` → `{ saveProcessed, saveEdited, readMeta, list, read, getSession, setSession }`（签名见 Step 3 实现）。
- Consumes: `lib/system-store.js`（`readJsonOrMissing`/`writeJsonAtomic`/`withJsonLock`）、`lib/novel-panel/contracts.js`（`assertValidUsername`/`isPlainObject`）。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-store.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchStore } = require('../lib/novel-fetch-store');

function tmpUsers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-store-'));
  return { usersDir: path.join(dir, 'users'), dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('saveProcessed writes txt + meta and lists', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    store.saveProcessed('tester', { bookId: '724852', platform: 3, platformName: '七猫付费', mode: 'induce', text: '优化后正文', report: '报告', gender: '女', style: '现代虐文' });
    const saved = store.read('tester', '724852');
    assert.equal(saved.text, '优化后正文');
    assert.equal(saved.meta.gender, '女');
    assert.equal(saved.meta.style, '现代虐文');
    const list = store.list('tester');
    assert.equal(list.length, 1);
    assert.equal(list[0].bookId, '724852');
    assert.equal(list[0].hasTxt, true);
  } finally { t.cleanup(); }
});

test('saveEdited updates text and updatedAt, keeps gender/style', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    store.saveProcessed('tester', { bookId: '1', platform: 2, platformName: '番茄付费', mode: 'hook', text: '原', gender: '男', style: '男频都市' });
    const first = store.read('tester', '1').meta.updatedAt;
    store.saveEdited('tester', '1', '编辑后正文');
    const saved = store.read('tester', '1');
    assert.equal(saved.text, '编辑后正文');
    assert.equal(saved.meta.gender, '男');
    assert.equal(saved.meta.style, '男频都市');
    assert.ok(saved.meta.updatedAt >= first);
  } finally { t.cleanup(); }
});

test('saveEdited without existing meta and no mode throws', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    assert.throws(() => store.saveEdited('tester', '9', '正文'), /尚未处理/);
  } finally { t.cleanup(); }
});

test('session set/get roundtrip', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    assert.equal(store.getSession('tester'), null);
    store.setSession('tester', 'PHPSESSID=abc123');
    assert.equal(store.getSession('tester').cookie, 'PHPSESSID=abc123');
  } finally { t.cleanup(); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-store.test.js`
Expected: FAIL（`../lib/novel-fetch-store` 不存在）。

- [ ] **Step 3: 实现 store**

创建 `lib/novel-fetch-store.js`：

```js
const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');
const { assertValidUsername, isPlainObject } = require('./novel-panel/contracts');

function createNovelFetchStore({ usersDir } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);

  function dir(username) {
    assertValidUsername(username);
    return path.join(resolvedUsersDir, username, 'novel-fetch');
  }
  function txtPath(username, bookId) { return path.join(dir(username), `${bookId}.txt`); }
  function metaPath(username, bookId) { return path.join(dir(username), `${bookId}.meta.json`); }
  function sessionPath(username) { return path.join(resolvedUsersDir, username, 'upload-target.json'); }
  function indexPath(username) { return path.join(dir(username), 'index.json'); }

  function readIndex(username) {
    const result = readJsonOrMissing(indexPath(username));
    return result.found && Array.isArray(result.value) ? result.value : [];
  }

  function writeIndex(username, books) {
    fs.mkdirSync(dir(username), { recursive: true });
    withJsonLock(path.join(dir(username), '.index.lock'), () => {
      writeJsonAtomic(indexPath(username), books);
    });
  }

  function readMeta(username, bookId) {
    const result = readJsonOrMissing(metaPath(username, bookId));
    return result.found && isPlainObject(result.value) ? result.value : null;
  }

  function upsertIndexEntry(username, meta, now) {
    const books = readIndex(username).filter(b => b && b.bookId !== meta.bookId);
    books.push({
      bookId: meta.bookId,
      platformName: meta.platformName || '',
      mode: meta.mode || '',
      gender: meta.gender || null,
      style: meta.style || null,
      savedAt: meta.savedAt,
      updatedAt: now,
      hasTxt: true
    });
    writeIndex(username, books);
  }

  function saveProcessed(username, entry) {
    assertValidUsername(username);
    const bookId = String(entry && entry.bookId || '').trim();
    if (!bookId) throw new Error('bookId is required');
    fs.mkdirSync(dir(username), { recursive: true });
    const now = new Date().toISOString();
    const meta = {
      bookId,
      platform: entry.platform || null,
      platformName: entry.platformName || '',
      mode: entry.mode || '',
      gender: entry.gender || null,
      style: entry.style || null,
      report: entry.report || '',
      savedAt: now,
      updatedAt: now
    };
    fs.writeFileSync(txtPath(username, bookId), String(entry.text || ''), 'utf8');
    writeJsonAtomic(metaPath(username, bookId), meta);
    upsertIndexEntry(username, meta, now);
    return meta;
  }

  function saveEdited(username, bookId, text, metaPatch = {}) {
    assertValidUsername(username);
    const bid = String(bookId || '').trim();
    if (!bid) throw new Error('bookId is required');
    fs.mkdirSync(dir(username), { recursive: true });
    let meta = readMeta(username, bid);
    const now = new Date().toISOString();
    if (meta) {
      meta = { ...meta, ...metaPatch, updatedAt: now };
    } else {
      if (!metaPatch.mode) throw new Error('该书尚未处理，无法保存');
      meta = {
        bookId: bid,
        platform: metaPatch.platform || null,
        platformName: metaPatch.platformName || '',
        mode: metaPatch.mode,
        gender: metaPatch.gender || null,
        style: metaPatch.style || null,
        report: metaPatch.report || '',
        savedAt: now,
        updatedAt: now
      };
    }
    fs.writeFileSync(txtPath(username, bid), String(text), 'utf8');
    writeJsonAtomic(metaPath(username, bid), meta);
    upsertIndexEntry(username, meta, now);
    return now;
  }

  function list(username) {
    return readIndex(username)
      .filter(b => isPlainObject(b) && b.bookId)
      .map(b => ({ ...b, hasTxt: fs.existsSync(txtPath(username, b.bookId)) }));
  }

  function read(username, bookId) {
    const bid = String(bookId || '').trim();
    const meta = readMeta(username, bid);
    if (!meta) return null;
    let text = '';
    try { text = fs.readFileSync(txtPath(username, bid), 'utf8'); } catch (_) {}
    return { meta, text };
  }

  function getSession(username) {
    const result = readJsonOrMissing(sessionPath(username));
    return result.found && isPlainObject(result.value) && typeof result.value.cookie === 'string' ? result.value : null;
  }

  function setSession(username, cookie) {
    assertValidUsername(username);
    writeJsonAtomic(sessionPath(username), { cookie, loginAt: new Date().toISOString() });
  }

  return { saveProcessed, saveEdited, readMeta, list, read, getSession, setSession };
}

module.exports = { createNovelFetchStore };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/novel-fetch-store.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/novel-fetch-store.js tests/novel-fetch-store.test.js
git commit -m "feat: add novel fetch per-user store with session"
```

---

### Task 3: 扩展 novel-fetch 路由（process 落盘 + /save + /saved）

**Files:**
- Modify: `routes/novel-fetch.js`（`createNovelFetchRouter` 注入 `novelFetchStore`；`/process` 返回 `analysis` 并落盘；新增 `POST /save`、`GET /saved`）
- Modify: `app.js`（创建并注入 store）
- Test: `tests/novel-fetch-save-contract.test.js`

**Interfaces:**
- Consumes: Task 1 `extractAnalysis`；Task 2 `createNovelFetchStore`。
- Produces: `POST /api/novel-fetch/save`（`{ bookId, text, meta? }` → `{ ok, savedAt }`）；`GET /api/novel-fetch/saved` → `{ books }`；`/process` 结果新增 `analysis` 且成功时自动落盘（store 存在时）。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-save-contract.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body || {});
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function fakeStore() {
  const saves = [];
  const metaByBook = new Map();
  return {
    saves,
    saveProcessed: (username, entry) => { saves.push({ type: 'processed', ...entry }); metaByBook.set(entry.bookId, entry); return entry; },
    saveEdited: (username, bookId, text, patch = {}) => { const prev = metaByBook.get(bookId) || {}; metaByBook.set(bookId, { ...prev, ...patch, bookId }); saves.push({ type: 'edited', bookId, text }); return '2026-08-18T00:00:00.000Z'; },
    readMeta: (username, bookId) => metaByBook.get(bookId) || null,
    list: () => Array.from(metaByBook.values()).map(m => ({ bookId: m.bookId, gender: m.gender, style: m.style })),
    read: () => ({ text: 'saved-text', meta: {} }),
    getSession: () => null,
    setSession: () => {}
  };
}

function makeApp(store, processWithAI) {
  return express()
    .use(express.json({ limit: '50mb' }))
    .use('/api/novel-fetch', createNovelFetchRouter({
      presetStore: { getPublished: () => ({ module: 'novel-fetch', protocolLock: { format: 'novel-fetch-process', operation: 'induce' }, body: 'prompt' }) },
      novelFetchStore: store,
      processWithAI: processWithAI || (async () => '### 一、分析结果\n{"gender":"女","style":"现代虐文"}\n### 二、合规检测报告\nr\n### 三、优化后全文\n优化正文'),
      auth: (req, res, next) => { req.username = 'tester'; next(); }
    }));
}

test('process returns analysis and saves processed text', async () => {
  const store = fakeStore();
  const result = await request(makeApp(store), { requestPath: '/api/novel-fetch/process', body: { mode: 'induce', items: [{ bookId: '1', text: '正文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].analysis.gender, '女');
  assert.equal(result.body.results[0].analysis.style, '现代虐文');
  assert.equal(result.body.results[0].text, '优化正文');
  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0].type, 'processed');
});

test('process still works when store is absent', async () => {
  const result = await request(makeApp(null), { requestPath: '/api/novel-fetch/process', body: { mode: 'induce', items: [{ bookId: '1', text: '正文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'ok');
});

test('save persists edited text', async () => {
  const store = fakeStore();
  store.readMeta = () => ({ bookId: '1', gender: '女', style: '现代虐文' });
  const result = await request(makeApp(store), { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: '编辑后' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(store.saves[0].type, 'edited');
  assert.equal(store.saves[0].text, '编辑后');
});

test('save rejects missing meta, bad id, empty text', async () => {
  const store = fakeStore(); // readMeta returns null
  const app = makeApp(store);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: 'x' } })).status, 400);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: 'abc', text: 'x' } })).status, 400);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: '' } })).status, 400);
});

test('saved lists books', async () => {
  const store = fakeStore();
  const result = await request(makeApp(store), { method: 'GET', requestPath: '/api/novel-fetch/saved' });
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.books));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-save-contract.test.js`
Expected: FAIL（`/save`/`/saved` 404，process 无 `analysis` 字段）。

- [ ] **Step 3: 修改 createNovelFetchRouter 与 /process**

在 `routes/novel-fetch.js` 的工厂签名与 `processOne` 定义处加入 store：

```js
function createNovelFetchRouter({ fetchUpstream: customFetch, auth = apiAuth, presetStore, processWithAI, novelFetchStore } = {}) {
  const fetchOne = customFetch || fetchUpstream;
  const processOne = processWithAI || defaultProcessWithAI;
  const router = express.Router();
  router.use(auth);
```

`/process` 内的单本处理改为（先解析 analysis，再复用 splitReportAndText，成功后落盘）：

```js
const results = await Promise.all(normalized.map(async ({ bookId, text }) => {
  try {
    const processed = await processOne(req.username, preset.body, text);
    const { gender, style, rest: withoutAnalysis } = extractAnalysis(processed);
    const { report, rest } = splitReportAndText(withoutAnalysis);
    const analysis = gender && style ? { gender, style } : null;
    if (novelFetchStore) {
      try {
        novelFetchStore.saveProcessed(req.username, {
          bookId,
          platform: normalizedPlatform,
          platformName,
          mode,
          text: rest,
          report,
          gender,
          style
        });
      } catch (saveError) {
        // 落盘失败不阻断处理结果返回
      }
    }
    return { bookId, status: 'ok', text: rest, report, analysis, error: null };
  } catch (error) {
    return { bookId, status: 'error', text: null, report: null, analysis: null, error: error.message || '处理失败' };
  }
}));
```

其中 `mode` 在函数开头已取到（`const { mode, items } = req.body`）。在 `/process` 顶部增加平台信息提取与校验（可选字段，不填则落盘 meta 为 null）：

```js
const { mode, items, platform, platformName } = req.body || {};
let normalizedPlatform = null;
if (platform !== undefined) {
  normalizedPlatform = Number(platform);
  if (!Number.isInteger(normalizedPlatform)) return res.status(400).json({ error: '无效的平台 ID' });
}
```

- [ ] **Step 4: 新增 POST /save 与 GET /saved**

在 `createNovelFetchRouter` 内 `/process` 之后新增：

```js
router.post('/save', async (req, res) => {
  try {
    if (!novelFetchStore) return res.status(400).json({ error: '存储未启用' });
    const { bookId, text, meta } = req.body || {};
    const bid = String(bookId || '').trim();
    if (!isValidBookId(bid)) return res.status(400).json({ error: '书籍 ID 格式不正确' });
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: '正文不能为空' });
    if (text.length > 120000) return res.status(400).json({ error: '正文过长' });
    const existing = novelFetchStore.readMeta(req.username, bid);
    if (!existing && !(meta && meta.mode)) return res.status(400).json({ error: '该书尚未处理，无法保存' });
    const savedAt = novelFetchStore.saveEdited(req.username, bid, text, meta && meta.mode ? meta : undefined);
    return res.json({ ok: true, savedAt });
  } catch (error) {
    return res.status(500).json({ error: error.message || '保存失败' });
  }
});

router.get('/saved', (req, res) => {
  if (!novelFetchStore) return res.json({ books: [] });
  return res.json({ books: novelFetchStore.list(req.username) });
});
```

- [ ] **Step 5: 前端 process 需传平台并保存 analysis（在 Task 7 一并完成，本步不动前端）**

`POST /process` 的 `items` 将扩展为 `{ bookId, text, platform, platformName }`（前端在 Task 7 修改 `handleProcess`/`handleProcessOne` 传入），以便落盘 meta 记录平台。`app.js` 的挂载改动在 Task 5 Step 5 一并完成。

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/novel-fetch-save-contract.test.js`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add routes/novel-fetch.js tests/novel-fetch-save-contract.test.js
git commit -m "feat: persist processed novels and add save/saved endpoints"
```

---

### Task 4: 目标站纯逻辑（target-upload）

**Files:**
- Create: `lib/target-upload.js`
- Test: `tests/target-upload.test.js`

**Interfaces:**
- Produces: 常量 `TARGET_HOST/TARGET_LOGIN_PATH/TARGET_UPLOAD_PATH/TARGET_CHECK_PATH`、`PLATFORM_ID/GENDER_ID/STYLE_ID`、`VALID_PLATFORM_IDS/VALID_STYLE_NAMES`、`DEFAULT_ADVANCED`；函数 `normalizeAdvanced(input)`、`buildUploadFields({platformId,gender,style,advanced})`、`buildMultipart(fields,{filename,content})`、`buildLoginUrl(username,password)`、`isLoginPage(body)`、`isDashboard(body)`、`requestHttp(options)`。
- Consumes: `node:http`。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/target-upload.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { STYLE_ID, PLATFORM_ID, GENDER_ID, normalizeAdvanced, buildUploadFields, buildMultipart, buildLoginUrl, isLoginPage, isDashboard, DEFAULT_ADVANCED } = require('../lib/target-upload');

test('mappings cover platforms, genders and styles', () => {
  assert.equal(PLATFORM_ID['七猫付费'], 3);
  assert.equal(GENDER_ID['男'], 1);
  assert.equal(STYLE_ID['现代虐文'], 301);
  assert.equal(STYLE_ID['男频都市'], 305);
  assert.equal(STYLE_ID['爆款BGM'], 309);
  assert.equal(STYLE_ID['职场打脸'], 312);
});

test('normalizeAdvanced clamps values and fills defaults', () => {
  const a = normalizeAdvanced({ jieyaNum: 99, gunpingNum: -5, jieyaSpeed: 9, jieyaPitch: 999, gunpingSpeed: -1 });
  assert.equal(a.jieyaNum, 20);
  assert.equal(a.gunpingNum, 0);
  assert.equal(a.jieyaSpeed, 2.0);
  assert.equal(a.jieyaPitch, 50);
  assert.equal(a.gunpingSpeed, 0.1);
  assert.equal(a.tl5, 0);
  assert.deepEqual(a.fontColorStyles, [1]);
  const empty = normalizeAdvanced();
  assert.equal(empty.jieyaNum, DEFAULT_ADVANCED.jieyaNum);
});

test('buildUploadFields maps gender/style to ids', () => {
  const f = buildUploadFields({ platformId: 3, gender: '女', style: '现代虐文', advanced: {} });
  assert.equal(f.platform_id, '3');
  assert.equal(f.gender, '2');
  assert.equal(f.style, '301');
  assert.ok(f.font_color_styles.includes('1'));
});

test('buildUploadFields throws on invalid platform/gender/style', () => {
  assert.throws(() => buildUploadFields({ platformId: 999, gender: '女', style: '现代虐文' }), /无效的平台/);
  assert.throws(() => buildUploadFields({ platformId: 3, gender: '其他', style: '现代虐文' }), /无效的性别/);
  assert.throws(() => buildUploadFields({ platformId: 3, gender: '女', style: '未知风格' }), /无效的风格/);
});

test('buildMultipart contains boundary, fields and file content', () => {
  const { boundary, body } = buildMultipart({ platform_id: '3', gender: '2' }, { filename: '1.txt', content: '小说正文' });
  const text = body.toString('utf8');
  assert.ok(text.includes(`--${boundary}`));
  assert.ok(text.includes('name="platform_id"'));
  assert.ok(text.includes('name="files[]"; filename="1.txt"'));
  assert.ok(text.includes('小说正文'));
});

test('buildLoginUrl encodes credentials', () => {
  const url = buildLoginUrl('u&x', 'p=x');
  assert.ok(url.includes('username=u%26x'));
  assert.ok(url.includes('password=p%3Dx'));
});

test('isLoginPage / isDashboard', () => {
  assert.equal(isLoginPage('<title>管理员登录</title>'), true);
  assert.equal(isDashboard('自定义文案 管理后台 管理员登录'), false);
  assert.equal(isDashboard('自定义文案 管理后台'), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/target-upload.test.js`
Expected: FAIL（`../lib/target-upload` 不存在）。

- [ ] **Step 3: 实现 lib/target-upload.js**

创建 `lib/target-upload.js`（内容见 Global Constraints 与 Task 4 接口，完整实现）：

```js
const http = require('node:http');

const TARGET_HOST = 'two.121w.com';
const TARGET_LOGIN_PATH = '/tttadmin/login.php';
const TARGET_UPLOAD_PATH = '/tttadmin/api/zbooklist_upload.php';
const TARGET_CHECK_PATH = '/tttadmin/zidingyi.php';

const PLATFORM_ID = { 黑岩付费: 1, 番茄付费: 2, 七猫付费: 3, 点众付费: 4, 阅文付费: 6, 番茄免费: 7, 知乎付费: 15, 掌阅付费: 20, 卓越付费: 26, 九州书城: 29, 掌文付费: 31 };
const GENDER_ID = { 男: 1, 女: 2 };
const STYLE_ID = {
  古风虐文: 101, 古风甜文: 102, 古风通用: 103,
  年代虐文: 201, 年代甜文: 202, 年代通用: 203,
  现代虐文: 301, 现代甜文: 302, 现代悬疑: 303, 现代通用: 304,
  男频都市: 305, 现代女主: 306, 玄幻: 307, 历史: 308,
  爆款BGM: 309, 家庭奇葩: 310, 家庭伤感: 311, 职场打脸: 312
};
const VALID_PLATFORM_IDS = new Set(Object.values(PLATFORM_ID));
const VALID_STYLE_NAMES = Object.keys(STYLE_ID);

const DEFAULT_ADVANCED = Object.freeze({
  tl5: 0, ziti: 1, zitidx: 62, biaohong: '', keywords: '', biaohongReuse: '',
  jieyaNum: 4, jieyaAiHead: 0, jieyaSpeed: 1.7, jieyaPitch: 0,
  gunpingNum: 4, gunpingSpeed: 1, fontColorStyles: [1]
});

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeAdvanced(input = {}) {
  const d = DEFAULT_ADVANCED;
  const styles = Array.isArray(input.fontColorStyles)
    ? input.fontColorStyles.map(Number).filter(Number.isInteger).slice(0, 4)
    : [];
  return {
    tl5: input.tl5 === 1 ? 1 : 0,
    ziti: Math.round(clamp(input.ziti, 1, 6, d.ziti)),
    zitidx: Math.round(clamp(input.zitidx, 30, 162, d.zitidx)),
    biaohong: String(input.biaohong || ''),
    keywords: String(input.keywords || ''),
    biaohongReuse: String(input.biaohongReuse || ''),
    jieyaNum: Math.round(clamp(input.jieyaNum, 0, 20, d.jieyaNum)),
    jieyaAiHead: [0, 1, 2].includes(Number(input.jieyaAiHead)) ? Number(input.jieyaAiHead) : 0,
    jieyaSpeed: clamp(input.jieyaSpeed, 0.5, 2.0, d.jieyaSpeed),
    jieyaPitch: Math.round(clamp(input.jieyaPitch, -50, 50, d.jieyaPitch)),
    gunpingNum: Math.round(clamp(input.gunpingNum, 0, 20, d.gunpingNum)),
    gunpingSpeed: clamp(input.gunpingSpeed, 0.1, 2.0, d.gunpingSpeed),
    fontColorStyles: styles.length > 0 ? styles : [...d.fontColorStyles]
  };
}

function buildUploadFields({ platformId, gender, style, advanced }) {
  const a = normalizeAdvanced(advanced);
  if (!VALID_PLATFORM_IDS.has(Number(platformId))) throw new Error('无效的平台');
  const genderId = GENDER_ID[gender];
  if (genderId === undefined) throw new Error('无效的性别');
  const styleId = STYLE_ID[style];
  if (styleId === undefined) throw new Error('无效的风格');
  return {
    platform_id: String(platformId),
    gender: String(genderId),
    style: String(styleId),
    tl5: String(a.tl5),
    ziti: String(a.ziti),
    zitidx: String(a.zitidx),
    biaohong: a.biaohong,
    biaohong_reuse: a.biaohongReuse,
    keywords: a.keywords,
    jieya_num: String(a.jieyaNum),
    jieya_ai_head: String(a.jieyaAiHead),
    jieya_speed: String(a.jieyaSpeed),
    jieya_pitch: String(a.jieyaPitch),
    font_color_styles: JSON.stringify(a.fontColorStyles),
    gunping_num: String(a.gunpingNum),
    gunping_speed: String(a.gunpingSpeed)
  };
}

function buildMultipart(fields, file) {
  const boundary = `----qiantie${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${file.filename}"\r\nContent-Type: text/plain\r\n\r\n`));
  chunks.push(Buffer.from(file.content, 'utf8'));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function buildLoginUrl(username, password) {
  const qs = new URLSearchParams({ username, password });
  return `http://${TARGET_HOST}${TARGET_LOGIN_PATH}?${qs.toString()}`;
}

function isLoginPage(body) {
  return String(body || '').includes('管理员登录');
}

function isDashboard(body) {
  const b = String(body || '');
  return b.includes('自定义文案') && !b.includes('管理员登录');
}

function requestHttp({ method = 'GET', url, headers = {}, body, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers }
    };
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  TARGET_HOST, TARGET_LOGIN_PATH, TARGET_UPLOAD_PATH, TARGET_CHECK_PATH,
  PLATFORM_ID, GENDER_ID, STYLE_ID, VALID_PLATFORM_IDS, VALID_STYLE_NAMES, DEFAULT_ADVANCED,
  normalizeAdvanced, buildUploadFields, buildMultipart, buildLoginUrl, isLoginPage, isDashboard, requestHttp
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/target-upload.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/target-upload.js tests/target-upload.test.js
git commit -m "feat: add target site upload helpers and field mappings"
```

---

### Task 5: 上传路由（登录/会话/批量上传）

**Files:**
- Create: `routes/novel-fetch-upload.js`
- Modify: `app.js`（挂载两个路由 + 创建 store）
- Test: `tests/novel-fetch-upload-routes.test.js`

**Interfaces:**
- Consumes: Task 2 store、Task 4 `target-upload`。
- Produces: `POST /api/novel-fetch-upload/upload-login`、`GET /api/novel-fetch-upload/upload-session`、`POST /api/novel-fetch-upload/upload-batch`（响应均**不含 401**）。

- [ ] **Step 1: 写失败契约测试**

创建 `tests/novel-fetch-upload-routes.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body || {});
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function makeStore(overrides = {}) {
  const session = overrides.session || { cookie: 'PHPSESSID=sess123' };
  const store = {
    getSession: () => session,
    setSession: () => {},
    read: overrides.read || (() => ({ text: '优化后正文', meta: { gender: '女', style: '现代虐文' } })),
    ...overrides.store
  };
  return store;
}

function makeApp({ store, httpClient, auth } = {}) {
  return express()
    .use(express.json())
    .use('/api/novel-fetch-upload', createNovelFetchUploadRouter({
      store: store || makeStore(),
      httpClient: httpClient || (async ({ method, url, headers, body }) => ({ status: 200, headers: { 'set-cookie': ['PHPSESSID=sess123; path=/'] }, body: JSON.stringify({ success: true }) })),
      auth: auth || ((req, res, next) => { req.username = 'tester'; next(); })
    }));
}

test('upload-login success stores cookie', async () => {
  const calls = [];
  const store = makeStore();
  store.setSession = (u, cookie) => { calls.push({ u, cookie }); };
  const app = makeApp({ store, httpClient: async ({ url }) => {
    if (url.includes('login.php')) return { status: 200, headers: { 'set-cookie': ['PHPSESSID=abc; path=/'] }, body: 'redirect' };
    return { status: 200, headers: {}, body: '自定义文案 管理后台' };
  } });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-login', body: { username: 'u', password: 'p' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(calls[0].cookie, 'PHPSESSID=abc');
});

test('upload-login rejects bad credentials without 401', async () => {
  const app = makeApp({ httpClient: async () => ({ status: 200, headers: {}, body: '管理员登录' }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-login', body: { username: 'u', password: 'wrong' } });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
});

test('upload-batch without session returns notLoggedIn (not 401)', async () => {
  const app = makeApp({ store: makeStore({ session: null }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.notLoggedIn, true);
});

test('upload-batch uploads each book sequentially and uses per-book gender/style', async () => {
  const requests = [];
  const app = makeApp({ httpClient: async (opts) => {
    requests.push({ url: opts.url, cookie: opts.headers.Cookie, body: opts.body.toString('utf8') });
    return { status: 200, headers: {}, body: JSON.stringify({ success: true }) };
  } });
  const result = await request(app, {
    requestPath: '/api/novel-fetch-upload/upload-batch',
    body: { platformId: 3, items: [
      { bookId: '1', gender: '女', style: '现代虐文' },
      { bookId: '2', gender: '男', style: '男频都市' }
    ] }
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.results.every(r => r.status === 'ok'));
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.includes('name="gender"') && requests[0].body.includes('2'));
  assert.ok(requests[1].body.includes('name="style"') && requests[1].body.includes('305'));
  assert.ok(requests[0].body.includes('优化后正文'));
});

test('upload-batch uses edited version from store', async () => {
  const requests = [];
  const store = makeStore({ read: () => ({ text: '这是用户编辑后的正文', meta: { gender: '女', style: '现代虐文' } }) });
  const app = makeApp({ store, httpClient: async (opts) => { requests.push(opts.body.toString('utf8')); return { status: 200, headers: {}, body: JSON.stringify({ success: true }) }; } });
  await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.ok(requests[0].includes('这是用户编辑后的正文'));
});

test('upload-batch one missing book fails that one, others continue', async () => {
  const store = makeStore({ read: (u, id) => (id === '2' ? null : { text: '正文', meta: { gender: '女', style: '现代虐文' } }) });
  const app = makeApp({ store });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [
    { bookId: '1', gender: '女', style: '现代虐文' },
    { bookId: '2', gender: '女', style: '现代虐文' }
  ] } });
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[1].status, 'error');
  assert.match(result.body.results[1].error, /未找到已保存的正文/);
});

test('upload-batch returns notLoggedIn when target returns login page', async () => {
  const app = makeApp({ httpClient: async () => ({ status: 200, headers: {}, body: '管理员登录' }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.notLoggedIn, true);
});

test('upload-session reports loggedIn', async () => {
  const app = makeApp({});
  const result = await request(app, { method: 'GET', requestPath: '/api/novel-fetch-upload/upload-session' });
  assert.equal(result.status, 200);
  assert.equal(result.body.loggedIn, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-upload-routes.test.js`
Expected: FAIL（`../routes/novel-fetch-upload` 不存在）。

- [ ] **Step 3: 实现 routes/novel-fetch-upload.js**

创建 `routes/novel-fetch-upload.js`：

```js
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const target = require('../lib/target-upload');

function isValidBookId(value) {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function createNovelFetchUploadRouter({ auth = apiAuth, store, httpClient = target.requestHttp } = {}) {
  const router = express.Router();
  router.use(auth);

  router.post('/upload-login', async (req, res) => {
    try {
      if (!store) return res.status(500).json({ ok: false, error: '上传存储未启用' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return res.status(400).json({ ok: false, error: '请输入账号和密码' });
      }
      const login = await httpClient({ method: 'GET', url: target.buildLoginUrl(username.trim(), password) });
      const setCookies = login.headers && login.headers['set-cookie'];
      const cookie = Array.isArray(setCookies) ? setCookies.map(c => c.split(';')[0]).join('; ') : '';
      if (!cookie) return res.status(400).json({ ok: false, error: '登录失败，请检查账号密码' });
      const check = await httpClient({
        method: 'GET',
        url: `http://${target.TARGET_HOST}${target.TARGET_CHECK_PATH}`,
        headers: { Cookie: cookie }
      });
      if (!target.isDashboard(check.body)) return res.status(400).json({ ok: false, error: '登录失败，请检查账号密码' });
      store.setSession(req.username, cookie);
      return res.json({ ok: true, username });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '登录失败' });
    }
  });

  router.get('/upload-session', (req, res) => {
    const session = store ? store.getSession(req.username) : null;
    return res.json({ ok: true, loggedIn: Boolean(session), lastVerifiedAt: session ? session.loginAt : null });
  });

  router.post('/upload-batch', async (req, res) => {
    try {
      if (!store) return res.status(500).json({ ok: false, error: '上传存储未启用' });
      const session = store.getSession(req.username);
      if (!session || !session.cookie) {
        return res.json({ ok: false, notLoggedIn: true, error: '请先登录目标站' });
      }
      const { platformId, advanced, items } = req.body || {};
      if (!target.VALID_PLATFORM_IDS.has(Number(platformId))) {
        return res.status(400).json({ ok: false, error: '无效的平台' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, error: '请选择要上传的书籍' });
      }
      if (items.length > 50) return res.status(400).json({ ok: false, error: '一次最多上传 50 本' });
      const normAdvanced = target.normalizeAdvanced(advanced);

      const results = [];
      for (const item of items) {
        const bookId = String(item && item.bookId || '').trim();
        if (!isValidBookId(bookId)) {
          results.push({ bookId, status: 'error', error: '书籍 ID 格式不正确' });
          continue;
        }
        const saved = store.read(req.username, bookId);
        if (!saved || !saved.text) {
          results.push({ bookId, status: 'error', error: '未找到已保存的正文' });
          continue;
        }
        const meta = saved.meta || {};
        const gender = String(item.gender || meta.gender || '').trim();
        const style = String(item.style || meta.style || '').trim();
        if (target.GENDER_ID[gender] === undefined || target.STYLE_ID[style] === undefined) {
          results.push({ bookId, status: 'error', error: '请为该本选择性别和风格' });
          continue;
        }
        let fields;
        try {
          fields = target.buildUploadFields({
            platformId,
            gender,
            style,
            advanced: {
              ...normAdvanced,
              jieyaNum: Number.isInteger(item.overrideJieyaNum) ? item.overrideJieyaNum : normAdvanced.jieyaNum,
              gunpingNum: Number.isInteger(item.overrideGunpingNum) ? item.overrideGunpingNum : normAdvanced.gunpingNum
            }
          });
        } catch (error) {
          results.push({ bookId, status: 'error', error: error.message });
          continue;
        }
        const { boundary, body } = target.buildMultipart(fields, { filename: `${bookId}.txt`, content: saved.text });
        try {
          const resp = await httpClient({
            method: 'POST',
            url: `http://${target.TARGET_HOST}${target.TARGET_UPLOAD_PATH}`,
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              Cookie: session.cookie
            },
            body
          });
          if (target.isLoginPage(resp.body)) {
            return res.json({ ok: false, notLoggedIn: true, error: '目标站登录已失效，请重新登录' });
          }
          let data = {};
          try { data = JSON.parse(resp.body); } catch (_) {}
          if (data.success === true) results.push({ bookId, status: 'ok', error: null });
          else results.push({ bookId, status: 'error', error: data.message || data.msg || '上传失败' });
        } catch (error) {
          results.push({ bookId, status: 'error', error: error.message || '上传失败' });
        }
      }
      return res.json({ ok: true, results });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '上传失败' });
    }
  });

  return router;
}

module.exports = { createNovelFetchUploadRouter, isValidBookId };
```

> 说明：上传响应解析里 `data.success === true` 依据目标站 `api/zbooklist_upload.php` 返回结构（已实测字段 `success`/`message`）；若返回 `msg` 亦兼容。

- [ ] **Step 4: app.js 接线（含 Task 3 延后的挂载）**

修改 `app.js`：
1. 顶部引入 `createNovelFetchStore` 与 `createNovelFetchUploadRouter`。
2. `createApp({ ..., novelFetchStore })` 内：

```js
const resolvedNovelFetchStore = novelFetchStore || createNovelFetchStore({ usersDir });
app.locals.novelFetchStore = resolvedNovelFetchStore;
```

3. 挂载改为：

```js
app.use('/api/novel-fetch', createNovelFetchRouter({ presetStore: resolvedPresetStore, novelFetchStore: resolvedNovelFetchStore }));
app.use('/api/novel-fetch-upload', createNovelFetchUploadRouter({ store: resolvedNovelFetchStore }));
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/novel-fetch-upload-routes.test.js`
Expected: PASS。再跑 `node --test tests/` 确认无既有回归（尤其是 novel-fetch-process-routes）。

- [ ] **Step 6: 提交**

```bash
git add routes/novel-fetch-upload.js app.js tests/novel-fetch-upload-routes.test.js
git commit -m "feat: add target site upload route with login/session/batch"
```

---

### Task 6: 前端 API 模块

**Files:**
- Modify: `frontend/src/shared/api/novelFetch.js`
- Test: `tests/novel-fetch-upload-ui-contract.test.js`（本文件覆盖 Task 6 与 Task 7）

**Interfaces:**
- Consumes: `./client` 的 `apiRequest`。
- Produces: `saveNovelContent({ bookId, text, meta })`、`listSavedNovels()`、`uploadLogin({ username, password })`、`getUploadSession()`、`uploadBatch(payload)`。

- [ ] **Step 1: 写失败契约测试（结构断言）**

创建 `tests/novel-fetch-upload-ui-contract.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiFile = path.join(__dirname, '..', 'frontend', 'src', 'shared', 'api', 'novelFetch.js');
const pageFile = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'NovelFetchPage.jsx');

test('novelFetch api exports upload helpers', () => {
  const s = fs.readFileSync(apiFile, 'utf8');
  for (const fn of ['saveNovelContent', 'listSavedNovels', 'uploadLogin', 'getUploadSession', 'uploadBatch']) {
    assert.ok(s.includes(`export function ${fn}`), `missing export ${fn}`);
  }
  assert.match(s, /\/api\/novel-fetch\/save/);
  assert.match(s, /\/api\/novel-fetch\/saved/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-login/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-session/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-batch/);
});

test('NovelFetchPage has edit modal and upload panel wiring', () => {
  const s = fs.readFileSync(pageFile, 'utf8');
  for (const token of ['对接上传', '编辑', 'saveNovelContent', 'uploadLogin', 'getUploadSession', 'uploadBatch', 'STYLE_OPTIONS', 'GENDER_OPTIONS', 'notLoggedIn']) {
    assert.ok(s.includes(token), `missing token: ${token}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-upload-ui-contract.test.js`
Expected: FAIL（导出与页面标记缺失）。

- [ ] **Step 3: 实现 API 模块**

先修改既有 `processNovelContent` 透传平台（`/process` 后端从 `req.body` 顶层读取）：

```js
export function processNovelContent({ mode, items, platform, platformName }) {
  return apiRequest('/api/novel-fetch/process', {
    method: 'POST',
    body: JSON.stringify({ mode, items, platform, platformName })
  });
}
```

再在 `frontend/src/shared/api/novelFetch.js` 末尾追加：

```js
export function saveNovelContent({ bookId, text, meta }) {
  return apiRequest('/api/novel-fetch/save', {
    method: 'POST',
    body: JSON.stringify({ bookId, text, meta })
  });
}

export function listSavedNovels() {
  return apiRequest('/api/novel-fetch/saved');
}

export function uploadLogin({ username, password }) {
  return apiRequest('/api/novel-fetch-upload/upload-login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export function getUploadSession() {
  return apiRequest('/api/novel-fetch-upload/upload-session');
}

export function uploadBatch(payload) {
  return apiRequest('/api/novel-fetch-upload/upload-batch', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
```

- [ ] **Step 4: 运行测试确认通过（API 部分）**

Run: `node --test tests/novel-fetch-upload-ui-contract.test.js`
Expected: 第一个 test PASS；第二个 test 仍 FAIL（页面未改，Task 7 处理）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/novelFetch.js tests/novel-fetch-upload-ui-contract.test.js
git commit -m "feat: add novel fetch upload api helpers"
```

---

### Task 7: 前端页面（编辑弹窗 + 对接上传面板）

**Files:**
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`
- Modify: `frontend/src/user/pages/novel-fetch.css`（如需样式）
- Test: `tests/novel-fetch-upload-ui-contract.test.js`（Task 6 已建）

**Interfaces:**
- Consumes: Task 6 的 5 个 API 函数；`processMode`/`processPresets`（既有）。
- Produces: 页面内「对接上传」入口、登录弹窗、上传配置弹窗、逐本列表、编辑弹窗、上传结果回显。

- [ ] **Step 1: 常量与新增 import**

在 `NovelFetchPage.jsx` 顶部，把 antd import 加入 `Table`：

```js
import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography, message } from 'antd';
```

并追加：

```js
import { UploadCloud, Pencil, Save } from 'lucide-react';
import { saveNovelContent, uploadLogin, getUploadSession, uploadBatch } from '../../shared/api/novelFetch';

const GENDER_OPTIONS = [
  { value: '男', label: '男频' },
  { value: '女', label: '女频' }
];

const STYLE_OPTIONS = [
  '古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用',
  '现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主',
  '玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'
].map(name => ({ value: name, label: name }));

const UPLOAD_PLATFORMS = [
  { id: 1, name: '黑岩付费' }, { id: 2, name: '番茄付费' }, { id: 3, name: '七猫付费' },
  { id: 4, name: '点众付费' }, { id: 6, name: '阅文付费' }, { id: 7, name: '番茄免费' },
  { id: 15, name: '知乎付费' }, { id: 20, name: '掌阅付费' }, { id: 26, name: '卓越付费' },
  { id: 29, name: '九州书城' }, { id: 31, name: '掌文付费' }
];

const DEFAULT_UPLOAD_ADVANCED = {
  jieyaNum: 4, jieyaAiHead: 0, jieyaSpeed: 1.7, jieyaPitch: 0,
  gunpingNum: 4, gunpingSpeed: 1
};
```

- [ ] **Step 2: 新增状态**

在 `NovelFetchPage()` 组件顶部追加状态：

```js
const [editModal, setEditModal] = useState(null);        // { bookId, platformName, mode, text, original } 编辑弹窗
const [editText, setEditText] = useState('');            // 编辑弹窗当前文本
const [editDirty, setEditDirty] = useState(false);       // 是否有未保存修改
const [uploadOpen, setUploadOpen] = useState(false);     // 上传配置弹窗
const [loginOpen, setLoginOpen] = useState(false);       // 登录弹窗
const [loginForm] = Form.useForm();                      // 登录表单
const [loggingIn, setLoggingIn] = useState(false);
const [loggedIn, setLoggedIn] = useState(false);
const [uploadConfig, setUploadConfig] = useState({ platformId: null, advanced: { ...DEFAULT_UPLOAD_ADVANCED } });
const [uploadItems, setUploadItems] = useState([]);      // [{ bookId, gender, style, overrideJieyaNum, overrideGunpingNum }]
const [uploading, setUploading] = useState(false);
const [uploadResults, setUploadResults] = useState([]);  // [{ bookId, status, error }]
```

- [ ] **Step 3: 更新 handleProcess / handleProcessOne（传平台 + 保存 analysis）**

现有 `handleProcess` 中 `processNovelContent` 的调用改为**顶层**携带平台（`/process` 后端从 `req.body` 顶层读取 `platform`/`platformName`，不放 items 内），并把 `induced` 状态扩展保存 `analysis`：

```js
const data = await processNovelContent({
  mode: processMode,
  platform: chosen[0]?.platform,
  platformName: chosen[0]?.platformName,
  items: chosen.map(row => ({ bookId: row.bookId, text: row.data }))
});
```

对应的 `setRows` 更新改为：

```js
setRows(current => current.map(row => {
  const result = results.find(item => item.bookId === row.bookId);
  return result ? {
    ...row,
    induced: result.status === 'ok' ? { mode: processMode, report: result.report, text: result.text, analysis: result.analysis || null, edited: false } : null,
    processError: result.status === 'ok' ? null : result.error
  } : row;
}));
```

`handleProcessOne` 同理：调用改为 `processNovelContent({ mode: processMode, platform: row.platform, platformName: row.platformName, items: [{ bookId: row.bookId, text: row.data }] })`；`setRows` 中 `induced` 加 `analysis: result.analysis || null`。

- [ ] **Step 4: 编辑弹窗逻辑**

新增函数：

```js
function openEdit(row) {
  const text = row.induced?.text ?? row.data ?? '';
  setEditModal({ bookId: row.bookId, platformName: row.platformName, mode: row.induced?.mode, gender: row.induced?.analysis?.gender || null, style: row.induced?.analysis?.style || null });
  setEditText(text);
  setEditDirty(false);
}

async function handleSaveEdit() {
  if (!editModal) return;
  if (!editText.trim()) { message.warning('正文不能为空'); return; }
  const meta = editModal.mode ? { mode: editModal.mode, platform: uploadConfig.platformId, platformName: editModal.platformName, gender: editModal.gender, style: editModal.style } : undefined;
  try {
    await saveNovelContent({ bookId: editModal.bookId, text: editText, meta });
    setEditDirty(false);
    setRows(current => current.map(r => r.bookId === editModal.bookId
      ? { ...r, induced: r.induced ? { ...r.induced, text: editText, edited: true } : r.induced }
      : r));
    message.success('已保存');
  } catch (error) {
    message.error(error.message || '保存失败');
  }
}
```

- [ ] **Step 5: 对接上传面板逻辑（登录 + 配置 + 上传）**

新增函数：

```js
async function openUploadPanel() {
  setUploadResults([]);
  const oks = okRows().filter(r => r.induced);
  if (oks.length === 0) { message.warning('请先对小说执行 AI 处理'); return; }
  const platformId = oks[0].platform;
  setUploadConfig({ platformId, advanced: { ...DEFAULT_UPLOAD_ADVANCED } });
  setUploadItems(oks.map(r => ({
    bookId: r.bookId,
    gender: r.induced?.analysis?.gender || '',
    style: r.induced?.analysis?.style || '',
    overrideJieyaNum: null,
    overrideGunpingNum: null
  })));
  let sessionOk = false;
  try {
    const session = await getUploadSession();
    sessionOk = Boolean(session && session.loggedIn);
  } catch (_) {
    sessionOk = false;
  }
  setLoggedIn(sessionOk);
  if (!sessionOk) { setLoginOpen(true); return; }
  setUploadOpen(true);
}

async function handleLogin() {
  const { username, password } = await loginForm.validateFields().catch(() => null);
  if (!username || !password) return;
  setLoggingIn(true);
  try {
    const data = await uploadLogin({ username, password });
    if (data.ok) { setLoggedIn(true); setLoginOpen(false); setUploadOpen(true); message.success('登录成功'); }
    else message.error(data.error || '登录失败');
  } catch (error) {
    message.error(error.message || '登录失败');
  } finally {
    setLoggingIn(false);
  }
}

async function handleUploadBatch() {
  if (uploadItems.some(i => !i.gender || !i.style)) { message.warning('请为每本选择性别和风格'); return; }
  setUploading(true);
  setUploadResults([]);
  try {
    const data = await uploadBatch({
      platformId: uploadConfig.platformId,
      advanced: uploadConfig.advanced,
      items: uploadItems
    });
    if (data.notLoggedIn) {
      message.warning(data.error || '请先登录目标站');
      setLoggedIn(false);
      setUploadOpen(false);
      setLoginOpen(true);
      return;
    }
    const results = data.results || [];
    setUploadResults(results);
    const ok = results.filter(r => r.status === 'ok').length;
    const fail = results.filter(r => r.status === 'error').length;
    if (fail === 0) message.success(`全部上传成功（${ok} 本）`);
    else message.warning(`成功 ${ok} 本，失败 ${fail} 本`);
  } catch (error) {
    message.error(error.message || '上传失败');
  } finally {
    setUploading(false);
  }
}
```

- [ ] **Step 6: 工具栏加入口 + 行内编辑按钮**

在工具栏「批量下载」按钮后追加：

```jsx
<Button size="small" icon={<UploadCloud size={14} aria-hidden="true" />} disabled={okRows().filter(r => r.induced).length === 0} onClick={openUploadPanel}>对接上传</Button>
```

在每行操作区「查看改编」按钮后追加（仅已处理行）：

```jsx
{row.induced ? (
  <Button size="small" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => openEdit(row)}>编辑</Button>
) : null}
```

- [ ] **Step 7: 编辑弹窗 Modal**

在 `</Space>` 结尾前追加：

```jsx
<Modal
  title={editModal ? `${editModal.bookId} — ${editModal.platformName}（${processPresets.find(p => p.value === editModal.mode)?.label || '改编'}）` : ''}
  open={Boolean(editModal)}
  width={900}
  destroyOnClose
  onCancel={() => {
    if (editDirty) {
      Modal.confirm({ title: '有未保存的修改', content: '关闭将丢失未保存的修改，确定关闭吗？', onOk: () => setEditModal(null) });
    } else {
      setEditModal(null);
    }
  }}
  footer={[
    <Button key="save" type="primary" icon={<Save size={14} aria-hidden="true" />} onClick={handleSaveEdit}>保存</Button>,
    <Button key="dl" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${editModal?.bookId}.txt`, editText)}>下载</Button>,
    <Button key="close" onClick={() => { if (editDirty) { Modal.confirm({ title: '有未保存的修改', content: '关闭将丢失未保存的修改，确定关闭吗？', onOk: () => setEditModal(null) }); } else { setEditModal(null); } }}>关闭</Button>
  ]}
>
  <Input.TextArea
    value={editText}
    rows={18}
    onChange={e => { setEditText(e.target.value); setEditDirty(true); }}
    className="novel-fetch-preview"
  />
</Modal>
```

- [ ] **Step 8: 登录弹窗 + 上传配置弹窗**

在编辑弹窗后追加：

```jsx
<Modal
  title="登录 two.121w.com"
  open={loginOpen}
  onCancel={() => setLoginOpen(false)}
  footer={[
    <Button key="cancel" onClick={() => setLoginOpen(false)}>取消</Button>,
    <Button key="login" type="primary" loading={loggingIn} onClick={handleLogin}>登录</Button>
  ]}
>
  <Form form={loginForm} layout="vertical">
    <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
      <Input autoComplete="username" />
    </Form.Item>
    <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
      <Input.Password autoComplete="current-password" />
    </Form.Item>
  </Form>
</Modal>

<Modal
  title="对接上传（two.121w.com）"
  open={uploadOpen}
  width={1000}
  onCancel={() => setUploadOpen(false)}
  footer={[
    <Button key="close" onClick={() => setUploadOpen(false)}>关闭</Button>,
    <Button key="upload" type="primary" icon={<UploadCloud size={14} aria-hidden="true" />} loading={uploading} onClick={handleUploadBatch}>开始上传</Button>
  ]}
>
  <Space direction="vertical" size={12} style={{ width: '100%' }}>
    <Space wrap>
      <span>平台：</span>
      <Select
        style={{ width: 150 }}
        value={uploadConfig.platformId}
        onChange={v => setUploadConfig(c => ({ ...c, platformId: v }))}
        options={UPLOAD_PLATFORMS.map(p => ({ value: p.id, label: p.name }))}
      />
      <span>解压数量：</span>
      <InputNumber min={0} max={20} value={uploadConfig.advanced.jieyaNum} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaNum: v } }))} />
      <span>AI头部：</span>
      <Select style={{ width: 130 }} value={uploadConfig.advanced.jieyaAiHead} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaAiHead: v } }))}
        options={[{ value: 0, label: '不加AI头部' }, { value: 1, label: '单个视频加AI头部' }, { value: 2, label: 'AI头部复用' }]} />
      <span>解压语速：</span>
      <InputNumber min={0.5} max={2.0} step={0.1} value={uploadConfig.advanced.jieyaSpeed} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaSpeed: v } }))} />
      <span>解压音调：</span>
      <InputNumber min={-50} max={50} value={uploadConfig.advanced.jieyaPitch} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, jieyaPitch: v } }))} />
      <span>滚屏数量：</span>
      <InputNumber min={0} max={20} value={uploadConfig.advanced.gunpingNum} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, gunpingNum: v } }))} />
      <span>滚屏语速：</span>
      <InputNumber min={0.1} max={2.0} step={0.1} value={uploadConfig.advanced.gunpingSpeed} onChange={v => setUploadConfig(c => ({ ...c, advanced: { ...c.advanced, gunpingSpeed: v } }))} />
    </Space>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
      每本使用自己的性别/风格（来自 AI 分析，可修改）。本期暂不支持背景音乐与自定义 AI 头部视频。
    </Typography.Paragraph>
    <Table
      size="small"
      rowKey="bookId"
      dataSource={uploadItems}
      pagination={false}
      columns={[
        { title: '书籍 ID', dataIndex: 'bookId', width: 180 },
        {
          title: '性别', dataIndex: 'gender', width: 120,
          render: (v, row) => <Select size="small" style={{ width: 110 }} value={v} options={GENDER_OPTIONS} onChange={g => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, gender: g } : i))} />
        },
        {
          title: '风格', dataIndex: 'style', width: 150,
          render: (v, row) => <Select size="small" showSearch style={{ width: 140 }} value={v} options={STYLE_OPTIONS} onChange={s => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, style: s } : i))} />
        },
        {
          title: '解压数量', dataIndex: 'overrideJieyaNum', width: 120,
          render: (v, row) => <InputNumber size="small" min={0} max={20} value={v} placeholder="默认" onChange={n => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, overrideJieyaNum: n } : i))} />
        },
        {
          title: '滚屏数量', dataIndex: 'overrideGunpingNum', width: 120,
          render: (v, row) => <InputNumber size="small" min={0} max={20} value={v} placeholder="默认" onChange={n => setUploadItems(list => list.map(i => i.bookId === row.bookId ? { ...i, overrideGunpingNum: n } : i))} />
        },
        {
          title: '状态', dataIndex: 'status', width: 160,
          render: (_, row) => {
            const r = uploadResults.find(x => x.bookId === row.bookId);
            if (!r) return <span>-</span>;
            return r.status === 'ok'
              ? <span style={{ color: '#389e0d' }}><Check size={14} aria-hidden="true" /> 成功</span>
              : <span style={{ color: '#cf1322' }}>失败：{r.error}</span>;
          }
        }
      ]}
    />
  </Space>
</Modal>
```

- [ ] **Step 9: 运行测试确认通过**

Run: `node --test tests/novel-fetch-upload-ui-contract.test.js`
Expected: PASS（两个 test 均通过）。

- [ ] **Step 10: 前端构建**

Run: `npm --prefix frontend run build`
Expected: 构建成功，退出码 0（仅允许既有分包警告）。

- [ ] **Step 11: 提交**

```bash
git add frontend/src/user/pages/NovelFetchPage.jsx frontend/src/user/pages/novel-fetch.css
git commit -m "feat: add edit modal and upload panel to novel fetch page"
```

---

### Task 8: 全量回归

**Files:**
- 无新增/修改。

**Interfaces:**
- 依赖 Task 1–7 全部落地。

- [ ] **Step 1: 全量后端测试**

Run: `node --test tests/`
Expected: 全部通过（含既有与新增 6 个测试文件）。

- [ ] **Step 2: 前端构建**

Run: `npm --prefix frontend run build`
Expected: 成功，退出码 0。

- [ ] **Step 3: 冒烟（可选，手动）**

启动服务，登录后打开 `/novel-fetch`：获取几本书 → AI 处理 → 编辑弹窗改文并保存 → 点「对接上传」→ 登录弹窗输入目标站账号密码 → 配置解压/滚屏 → 逐本上传 → 回显结果。到 two.121w.com 自定义文案页确认新记录。
注意：请先在浏览器手动登录过一次 two.121w.com 以便比对，但功能本身通过后端独立登录。

- [ ] **Step 4: 提交**

无代码改动则无需提交。若发现并修复回归问题，单独提交并说明。
