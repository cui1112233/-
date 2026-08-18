# 本地存储文件夹 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户可在「设置」配置一个后端可读写的本地文件夹，各功能（剧本生成、小说获取、改编小说、小说面板、水火制作、配音）的最终结果文件按功能/项目写入该文件夹，并提供「恢复」扫描。

**Architecture:** 核心存储逻辑抽成纯函数集中在 `lib/storage-root.js`（路径解析 + 各类结果写入 + 扫描恢复），现有各路由做**薄接线**（保持普通 router，不重构为工厂）；新增 `routes/storage.js`（工厂模式）提供 `/api/storage/save-media`、`/list`、`/restore`。配置经 `data/users/<username>/api-config.json` 的 `storageRoot` 字段存取。设置页新增输入/保存/恢复/清单 UI。

**Tech Stack:** Node.js + Express（后端），React（前端设置页/小说获取页/配音页/水火工作台）。

## Global Constraints

- 未配置 `storageRoot` 时，所有现有行为完全不变（写回 `data/users` / `data/shuihuo-objects`）。
- 旧数据不迁移；本地文件夹只对**新输出**生效。
- 本地文件夹只放**最终结果**；索引、草稿、中间状态仍留 `data/users`。
- 目录结构固定：`剧本生成/`、`小说获取/`、`改编小说/`、`制作工程/<项目名>/{输出结果.md,图片,视频,剪映,配音}`。
- 项目名清洗：替换 `\ / : * ? " < > |` 为 `_`，去首尾空白，空名回退 `未命名项目`。
- 路径安全：功能名只用固定常量，项目名先清洗再拼接；`storageRoot` 仅接受绝对路径。
- 语言：代码注释与文案用中文。
- 测试：Node 内置 `node:test` + `node:assert/strict`；每个新函数先写失败测试（TDD）。
- 现有 `config/history/novel-panel/tts` 为普通 router（`module.exports = router`），**不做工厂化重构**，只加薄接线。

---

### Task 1: 存储根目录 helper（lib/storage-root.js）+ 配置字段

**Files:**
- Create: `lib/storage-root.js`
- Modify: `lib/shared.js`（`DEFAULT_CONFIG` 加 `storageRoot: ''`）
- Test: `tests/storage-root.test.js`

**Interfaces:**
- Produces（后续任务全部依赖）：
  - `FEATURE_SCRIPT = '剧本生成'`、`FEATURE_NOVEL_FETCH = '小说获取'`、`FEATURE_NOVEL_ADAPT = '改编小说'`、`FEATURE_PRODUCTION = '制作工程'`
  - `sanitizeProjectName(name) → string`
  - `getStorageRoot(username, readConfigFn = readConfig) → string | null`
  - `featureDir(root, feature) → string`（mkdir recursive）
  - `projectDir(root, projectName) → string`（创建 `制作工程/<项目名>` 及 `图片/视频/剪映/配音` 子目录）

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-root.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FEATURE_SCRIPT, FEATURE_NOVEL_FETCH, FEATURE_NOVEL_ADAPT, FEATURE_PRODUCTION,
  sanitizeProjectName, getStorageRoot, featureDir, projectDir
} = require('../lib/storage-root');

test('sanitizeProjectName cleans illegal characters and falls back', () => {
  assert.equal(sanitizeProjectName('我的 项目: 一/二'), '我的_项目_ 一_二');
  assert.equal(sanitizeProjectName('   '), '未命名项目');
  assert.equal(sanitizeProjectName('a|b<c>d?e*f"g\\h'), 'a_b_c_d_e_f_g_h');
});

test('getStorageRoot reads config storageRoot and returns null when empty', () => {
  const fakeRead = () => ({ storageRoot: '   ' });
  assert.equal(getStorageRoot('u', fakeRead), null);
  assert.equal(getStorageRoot('u', () => ({})), null);
  assert.equal(getStorageRoot('u', () => ({ storageRoot: 'D:\\我的工程' })), 'D:\\我的工程');
});

test('featureDir creates the feature subfolder under root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-feature-'));
  try {
    const dir = featureDir(root, FEATURE_SCRIPT);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(path.basename(dir), '剧本生成');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('projectDir creates project folder with media subfolders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-project-'));
  try {
    const dir = projectDir(root, '测试项目/1');
    assert.equal(fs.existsSync(dir), true);
    for (const sub of ['图片', '视频', '剪映', '配音']) {
      assert.equal(fs.existsSync(path.join(dir, sub)), true, sub);
    }
    assert.equal(path.basename(dir), '测试项目_1');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-root.test.js`
Expected: FAIL（`Cannot find module '../lib/storage-root'`）

- [ ] **Step 3: 实现 lib/storage-root.js**

```js
// lib/storage-root.js
const path = require('node:path');
const fs = require('node:fs');
const { readConfig } = require('./shared');

const FEATURE_SCRIPT = '剧本生成';
const FEATURE_NOVEL_FETCH = '小说获取';
const FEATURE_NOVEL_ADAPT = '改编小说';
const FEATURE_PRODUCTION = '制作工程';

function sanitizeProjectName(name) {
  const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned || '未命名项目';
}

function getStorageRoot(username, readConfigFn = readConfig) {
  const config = readConfigFn(username);
  const root = typeof config.storageRoot === 'string' ? config.storageRoot.trim() : '';
  return root || null;
}

function featureDir(root, feature) {
  const dir = path.join(root, feature);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function projectDir(root, projectName) {
  const dir = path.join(root, FEATURE_PRODUCTION, sanitizeProjectName(projectName));
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ['图片', '视频', '剪映', '配音']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

module.exports = { FEATURE_SCRIPT, FEATURE_NOVEL_FETCH, FEATURE_NOVEL_ADAPT, FEATURE_PRODUCTION, sanitizeProjectName, getStorageRoot, featureDir, projectDir };
```

- [ ] **Step 4: 给 DEFAULT_CONFIG 加 storageRoot**

在 `lib/shared.js` 的 `DEFAULT_CONFIG` 对象中加入 `storageRoot: ''`（`publicConfig` 已自动透传除 apiKey 外的字段）。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/storage-root.test.js`
Expected: PASS（4/4）

- [ ] **Step 6: 提交**

```bash
git add lib/storage-root.js lib/shared.js tests/storage-root.test.js
git commit -m "feat: add storage root helper and config field"
```

---

### Task 2: 配置校验 + 设置页 UI

**Files:**
- Modify: `lib/storage-root.js`（新增 `normalizeStorageRoot(value) → { value, error }`）
- Modify: `routes/config.js`（POST 校验 storageRoot）
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Test: `tests/storage-config.test.js`

**Interfaces:**
- Consumes: `normalizeStorageRoot`（本任务新增到 lib/storage-root.js）
- Produces: `storageRoot` 随 GET/POST /api/config 透传；设置页输入/保存/恢复按钮

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeStorageRoot } = require('../lib/storage-root');

test('normalizeStorageRoot rejects non-absolute path', () => {
  const r = normalizeStorageRoot('相对路径');
  assert.notEqual(r.error, undefined);
  assert.match(r.error, /绝对路径/);
});

test('normalizeStorageRoot trims and accepts absolute path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-norm-'));
  try {
    const r = normalizeStorageRoot(`  ${root}  `);
    assert.equal(r.error, undefined);
    assert.equal(r.value, root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('normalizeStorageRoot allows empty (clear) and reports mkdir failure', () => {
  assert.equal(normalizeStorageRoot('').error, undefined);
  assert.equal(normalizeStorageRoot('').value, '');
  const bad = path.join('Z:', 'nope', 'no-such-dir-xyz');
  const r = normalizeStorageRoot(bad);
  assert.notEqual(r.error, undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-config.test.js`
Expected: FAIL（`normalizeStorageRoot` 未导出）

- [ ] **Step 3: 实现 normalizeStorageRoot**

在 `lib/storage-root.js` 追加：

```js
function normalizeStorageRoot(value) {
  const cleaned = String(value == null ? '' : value).trim();
  if (cleaned === '') return { value: '', error: undefined };
  if (!path.isAbsolute(cleaned)) return { value: cleaned, error: '本地存储文件夹必须是绝对路径，或留空以关闭' };
  try {
    fs.mkdirSync(cleaned, { recursive: true });
    return { value: cleaned, error: undefined };
  } catch (error) {
    return { value: cleaned, error: `无法创建本地存储文件夹：${error.message}` };
  }
}
```

并加入 `module.exports`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-config.test.js`
Expected: PASS（3/3）

- [ ] **Step 5: 接线 routes/config.js**

`routes/config.js` 的 POST 处理中，写回前加入：

```js
const { normalizeStorageRoot } = require('../lib/storage-root');
// POST 内、写回配置前：
if (req.body && typeof req.body.storageRoot === 'string') {
  const result = normalizeStorageRoot(req.body.storageRoot);
  if (result.error) return res.status(400).json({ error: result.error });
  req.body.storageRoot = result.value;
}
```

GET 已通过 `publicConfig` 透传 storageRoot，无需改。

- [ ] **Step 6: 设置页 UI**

在 `frontend/src/user/pages/SettingsPage.jsx` 增加「本地存储文件夹」区块：
- 文本输入框 `storageRoot`（placeholder：`例如 D:\我的小说工程`，留空表示关闭）
- 「保存」按钮：把 storageRoot 一并 POST /api/config，后端返回错误则提示
- 「恢复」按钮：调 `POST /api/storage/restore`（Task 8 就绪后接线，本期先留按钮）
- 「查看文件清单」入口：调 `GET /api/storage/list`（Task 8 就绪后接线）
- 保存表单新增字段映射到 api-config（读取时用 GET /api/config 的 storageRoot 回填）

- [ ] **Step 7: 回归配置相关测试**

Run: `node --test tests/governance-routes.test.js`
Expected: PASS（默认 storageRoot 为空，行为不变）

- [ ] **Step 8: 提交**

```bash
git add lib/storage-root.js routes/config.js frontend/src/user/pages/SettingsPage.jsx tests/storage-config.test.js
git commit -m "feat: validate and persist storageRoot in config and settings UI"
```

---

### Task 3: 剧本生成结果 md 写入本地文件夹

**Files:**
- Modify: `lib/storage-root.js`（新增 `buildScriptMd(history) → string`、`writeScriptResultMd(root, history) → string|null`）
- Modify: `routes/history.js`（POST /api/history 保存时薄接线）
- Test: `tests/storage-script.test.js`

**Interfaces:**
- Consumes: `featureDir`、`FEATURE_SCRIPT`（Task 1）
- Produces: `buildScriptMd(history)`、`writeScriptResultMd(root, history)`（返回写入文件路径或 null）

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-script.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildScriptMd, writeScriptResultMd, FEATURE_SCRIPT } = require('../lib/storage-root');

test('buildScriptMd includes title, meta header and body', () => {
  const history = { id: 'h1', title: '测试剧本', format: '短剧', mode: '旁白', duration: '3分钟', createdAt: 0, output: '第1集 开场……' };
  const md = buildScriptMd(history);
  assert.match(md, /^# 测试剧本/m);
  assert.match(md, /格式：短剧/);
  assert.match(md, /第1集 开场/);
});

test('writeScriptResultMd writes into 剧本生成 folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-script-'));
  try {
    const history = { id: 'h1', title: 'T', format: '', mode: '', duration: '', createdAt: 0, output: '正文' };
    const file = writeScriptResultMd(root, history);
    assert.ok(file);
    assert.equal(path.basename(file), 'h1.md');
    assert.equal(path.dirname(file).endsWith(FEATURE_SCRIPT), true);
    assert.match(fs.readFileSync(file, 'utf8'), /正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeScriptResultMd returns null when root is null', () => {
  assert.equal(writeScriptResultMd(null, { id: 'h1', output: 'x' }), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-script.test.js`
Expected: FAIL（`buildScriptMd`/`writeScriptResultMd` 未导出）

- [ ] **Step 3: 实现**

在 `lib/storage-root.js` 追加：

```js
function buildScriptMd(history) {
  const title = String(history.title || history.id || '剧本').replace(/^#+\s*/, '').trim() || '剧本';
  const header = `格式：${history.format || ''}　模式：${history.mode || ''}　时长：${history.duration || ''}`;
  const when = history.createdAt ? `　生成时间：${new Date(history.createdAt).toLocaleString('zh-CN')}` : '';
  return [`# ${title}`, '', `> ${header}${when}`, '', String(history.output || '')].join('\n');
}

function writeScriptResultMd(root, history) {
  if (!root || !history) return null;
  const dir = featureDir(root, FEATURE_SCRIPT);
  const file = path.join(dir, `${history.id}.md`);
  fs.writeFileSync(file, buildScriptMd(history), 'utf8');
  return file;
}
```

加入 `module.exports`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-script.test.js`
Expected: PASS（3/3）

- [ ] **Step 5: 接线 routes/history.js**

`routes/history.js` 的 POST /api/history 保存成功、拿到 history 记录后：

```js
const { getStorageRoot, writeScriptResultMd } = require('../lib/storage-root');
// 保存并写 index 之后：
try {
  const storageRoot = getStorageRoot(req.auth.account.username);
  if (storageRoot) writeScriptResultMd(storageRoot, historyRecord);
} catch (_) { /* 本地副本失败不影响主流程 */ }
```

（`historyRecord` 即写回 index 的那条记录，含 `id/title/format/mode/duration/createdAt/output`。）

- [ ] **Step 6: 回归**

Run: `node --test tests/governance-routes.test.js tests/seed-accounts.test.js`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lib/storage-root.js routes/history.js tests/storage-script.test.js
git commit -m "feat: write script results as md copy to local storage folder"
```

---

### Task 4: 小说获取 / 改编小说 保存到本地文件夹

**Files:**
- Modify: `routes/novel-fetch.js`（`POST /` 与 `POST /process` 增加 `saveToFolder` + `bookId`）
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`（「下载」改调后端保存）
- Test: `tests/storage-novel-fetch.test.js`

**Interfaces:**
- Consumes: `featureDir`、`FEATURE_NOVEL_FETCH`/`FEATURE_NOVEL_ADAPT`（Task 1）
- Produces: 请求体 `{ platform, bookIds, maxTxt, saveToFolder?: boolean }` 与 process 的 `{ bookId, saveToFolder?: boolean, ... }`

- [ ] **Step 1: 写失败测试**

`routes/novel-fetch.js` 已是 `createNovelFetchRouter` 工厂，测试沿用现有依赖注入方式。

```js
// tests/storage-novel-fetch.test.js
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); }); });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

test('novel fetch saves txt to local folder when saveToFolder is true', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-nf-'));
  try {
    const app = createNovelFetchRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      fetchUpstream: async ({ bookid }) => ({ status: 200, data: `这是《${bookid}》的正文内容` }),
      getStorageRootFn: () => root
    });
    const res = await request(app, { requestPath: '/api/novel-fetch', body: { platform: 2, bookIds: ['111'], maxTxt: 100, saveToFolder: true } });
    assert.equal(res.status, 200);
    const file = path.join(root, '小说获取', '111.txt');
    assert.equal(fs.existsSync(file), true);
    assert.match(fs.readFileSync(file, 'utf8'), /这是《111》的正文内容/);
    const res2 = await request(app, { requestPath: '/api/novel-fetch/process', body: { bookId: '111', text: '原文', saveToFolder: true } });
    assert.equal(res2.status, 200);
    assert.equal(fs.existsSync(path.join(root, '改编小说', '111.txt')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('novel fetch does not write files without saveToFolder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-nf2-'));
  try {
    const app = createNovelFetchRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      fetchUpstream: async ({ bookid }) => ({ status: 200, data: '正文' }),
      getStorageRootFn: () => root
    });
    const res = await request(app, { requestPath: '/api/novel-fetch', body: { platform: 2, bookIds: ['222'], maxTxt: 100 } });
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(root, '小说获取', '222.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-novel-fetch.test.js`
Expected: FAIL（现有路由不识别 `saveToFolder`；`createNovelFetchRouter` 不接受 `getStorageRootFn`）

- [ ] **Step 3: 实现**

- `createNovelFetchRouter` 增加可选 `{ getStorageRootFn = getStorageRoot }`。
- 保存逻辑抽到 `lib/storage-root.js` 的 `writeNovelFetchResult(root, feature, bookId, data) → boolean`（写入 `featureDir(root, feature)/<bookId>.txt`，失败返回 false），加入导出：

```js
function writeNovelFetchResult(root, feature, bookId, data) {
  if (!root || !bookId) return false;
  try {
    fs.writeFileSync(path.join(featureDir(root, feature), `${bookId}.txt`), String(data ?? ''), 'utf8');
    return true;
  } catch (_) { return false; }
}
```

- `POST /`：解析 `saveToFolder`，对每个成功结果：若 true 且 root 非空，`const saved = writeNovelFetchResult(root, FEATURE_NOVEL_FETCH, bookId, data)`，结果对象加 `savedToFolder: saved`。
- `POST /process`：同样，feature 用 `FEATURE_NOVEL_ADAPT`。
- 保存失败不阻断整体响应。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-novel-fetch.test.js`
Expected: PASS（2/2）

- [ ] **Step 5: 前端 NovelFetchPage「下载」改后端保存**

在 `frontend/src/user/pages/NovelFetchPage.jsx`：
- 结果行「下载」按钮改调 `POST /api/novel-fetch`（或 process）带 `saveToFolder: true` + `bookId`；响应 `savedToFolder:true` 提示「已保存到本地文件夹（小说获取/改编小说）」；否则提示「未配置本地存储文件夹」并走原有浏览器 blob 下载兜底。

- [ ] **Step 6: 回归既有 novel-fetch 测试**

Run: `node --test tests/novel-fetch-routes.test.js tests/novel-fetch-contract.test.js tests/novel-fetch-process-routes.test.js`
Expected: PASS（默认 `saveToFolder` 为 false，行为不变）

- [ ] **Step 7: 提交**

```bash
git add lib/storage-root.js routes/novel-fetch.js frontend/src/user/pages/NovelFetchPage.jsx tests/storage-novel-fetch.test.js
git commit -m "feat: cache novel-fetch and adapted txt to local folder on download"
```

---

### Task 5: 小说面板输出结果导出 md

**Files:**
- Modify: `lib/storage-root.js`（新增 `buildNovelPanelExportMd(project) → string`、`writeNovelPanelExport(root, project) → string|null`）
- Modify: `routes/novel-panel.js`（新增 `POST /api/novel-panel/:id/export`）
- Modify: `public/novel-panel/workbench/app.js` + `index.html`（「导出结果」按钮接线）
- Test: `tests/storage-novel-panel-export.test.js`

**Interfaces:**
- Consumes: `projectDir`（Task 1）
- Produces: `buildNovelPanelExportMd(project)`、`writeNovelPanelExport(root, project)`；`POST /api/novel-panel/:id/export` → `{ saved, path? }`

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-novel-panel-export.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildNovelPanelExportMd, writeNovelPanelExport } = require('../lib/storage-root');

test('buildNovelPanelExportMd lists final segments', () => {
  const project = { id: 'p1', name: '我的剧集/一', data: { final_segments: [{ finalText: '最终第一段' }, { finalText: '' , sourceText: '来源第二段' }] } };
  const md = buildNovelPanelExportMd(project);
  assert.match(md, /# 我的剧集\/一　输出结果/);
  assert.match(md, /最终第一段/);
  assert.match(md, /来源第二段/);
});

test('writeNovelPanelExport writes 输出结果.md into project folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-npe-'));
  try {
    const project = { id: 'p1', name: '我的剧集/一', data: { final_segments: [{ finalText: '正文' }] } };
    const file = writeNovelPanelExport(root, project);
    assert.ok(file);
    assert.equal(path.basename(path.dirname(file)), '我的剧集_一');
    assert.equal(path.basename(file), '输出结果.md');
    assert.match(fs.readFileSync(file, 'utf8'), /正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeNovelPanelExport returns null without root', () => {
  assert.equal(writeNovelPanelExport(null, { name: 'x', data: {} }), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-novel-panel-export.test.js`
Expected: FAIL（未导出）

- [ ] **Step 3: 实现**

在 `lib/storage-root.js` 追加：

```js
function buildNovelPanelExportMd(project) {
  const name = String(project && project.name ? project.name : '未命名项目');
  const segments = (project && project.data && Array.isArray(project.data.final_segments)) ? project.data.final_segments : [];
  const body = segments.map((s, i) => `## 第 ${i + 1} 段\n\n${s.finalText || s.sourceText || ''}`).join('\n\n');
  return [`# ${name}　输出结果`, '', body].join('\n');
}

function writeNovelPanelExport(root, project) {
  if (!root || !project) return null;
  const dir = projectDir(root, project.name);
  const file = path.join(dir, '输出结果.md');
  fs.writeFileSync(file, buildNovelPanelExportMd(project), 'utf8');
  return file;
}
```

加入 `module.exports`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-novel-panel-export.test.js`
Expected: PASS（3/3）

- [ ] **Step 5: 接线 routes/novel-panel.js**

- 顶部引入 `const { getStorageRoot, writeNovelPanelExport } = require('../lib/storage-root');`
- 新增（放在项目相关路由处，鉴权沿用该 router 既有中间件）：

```js
router.post('/:id/export', (req, res) => {
  const project = store.loadProject(req.username, req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const root = getStorageRoot(req.auth ? req.auth.account.username : (req.username || ''));
  if (!root) return res.json({ saved: false, reason: '未配置本地存储文件夹' });
  const file = writeNovelPanelExport(root, project);
  res.json({ saved: true, path: file });
});
```

（`store` 即 novel-panel 路由闭包内的项目 store；若 `req.username` 未设置，用 `req.auth.account.username` 作为兜底。）

- [ ] **Step 6: 工作台「导出结果」接线**

在 `public/novel-panel/workbench/app.js` 找到「导出 TXT」处理（`exportTxt`，约 11767 行）附近新增「导出结果（md 到本地文件夹）」：经 bridge 调 `POST /api/novel-panel/{projectId}/export`；成功提示「已保存到 制作工程/<项目>/输出结果.md」，`saved:false` 提示「未配置本地存储文件夹」。在 `public/novel-panel/workbench/index.html` 工具栏加对应按钮。

- [ ] **Step 7: 回归 novel-panel 相关测试**

Run: `node --test tests/novel-panel-stability.test.js tests/novel-panel-asset-contract.test.js`
Expected: 与基线一致（仅既有失败项，无新增）

- [ ] **Step 8: 提交**

```bash
git add lib/storage-root.js routes/novel-panel.js public/novel-panel/workbench/app.js public/novel-panel/workbench/index.html tests/storage-novel-panel-export.test.js
git commit -m "feat: export novel-panel output md into local project folder"
```

---

### Task 6: 配音保存 mp3 到项目文件夹

**Files:**
- Modify: `lib/storage-root.js`（新增 `saveDubbingAudio(root, projectName, buffer, ext) → string|null`）
- Modify: `routes/tts.js`（接受 `projectName`，缓冲音频后保存）
- Modify: `frontend/src/user/pages/TtsPage.jsx`（可选项目名输入）
- Test: `tests/storage-tts.test.js`

**Interfaces:**
- Consumes: `projectDir`（Task 1）
- Produces: `saveDubbingAudio(root, projectName, buffer, ext='mp3')`；`POST /api/tts` 请求体增加可选 `projectName`

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-tts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveDubbingAudio } = require('../lib/storage-root');

test('saveDubbingAudio writes mp3 into project 配音 folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-tts-'));
  try {
    const audio = Buffer.from('fake-mp3-bytes');
    const file = saveDubbingAudio(root, '剧集A', audio);
    assert.ok(file);
    assert.equal(path.dirname(file).endsWith(path.join('制作工程', '剧集A', '配音')), true);
    assert.match(path.basename(file), /\.mp3$/);
    assert.deepEqual(fs.readFileSync(file), audio);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('saveDubbingAudio returns null without root or projectName', () => {
  assert.equal(saveDubbingAudio(null, 'p', Buffer.from('x')), null);
  assert.equal(saveDubbingAudio('D:\\root', '', Buffer.from('x')), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-tts.test.js`
Expected: FAIL（未导出）

- [ ] **Step 3: 实现**

在 `lib/storage-root.js` 追加：

```js
function saveDubbingAudio(root, projectName, buffer, ext = 'mp3') {
  if (!root || !projectName || !buffer) return null;
  try {
    const dir = path.join(projectDir(root, projectName), '配音');
    const file = path.join(dir, `${Date.now()}.${ext}`);
    fs.writeFileSync(file, buffer);
    return file;
  } catch (_) { return null; }
}
```

加入 `module.exports`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-tts.test.js`
Expected: PASS（2/2）

- [ ] **Step 5: 接线 routes/tts.js**

`routes/tts.js` 目前把上游音频 `pipe` 回浏览器。改为**缓冲后回写**（同时支持落盘）：
- 从请求体解析 `projectName`（可选）。
- 收到上游响应后收集 buffer，设置 `Content-Type`/`Content-Length` 回写浏览器。
- 落盘：

```js
const { getStorageRoot, saveDubbingAudio } = require('../lib/storage-root');
// 上游成功、buffer 就绪后：
const projectName = (req.body && req.body.projectName) ? String(req.body.projectName).trim() : '';
const root = getStorageRoot(req.auth ? req.auth.account.username : (req.username || ''));
if (root && projectName) saveDubbingAudio(root, projectName, buffer);
```

（注意保持原有透传语义与超时处理；缓冲可能导致大文件内存占用，TTS 音频量级可接受。）

- [ ] **Step 6: 前端 TtsPage 增加「所属项目」输入**

在 `frontend/src/user/pages/TtsPage.jsx` 增加可选「所属项目」输入框，请求体带上 `projectName`；下载时提示「已保存到 制作工程/<项目>/配音」。

- [ ] **Step 7: 回归**

Run: `node --test tests/*tts*` 及含 TTS 的契约测试
Expected: 无新增失败

- [ ] **Step 8: 提交**

```bash
git add lib/storage-root.js routes/tts.js frontend/src/user/pages/TtsPage.jsx tests/storage-tts.test.js
git commit -m "feat: save dubbing mp3 into local project folder when project name provided"
```

---

### Task 7: 水火图片/视频 下载时保存到项目文件夹

**Files:**
- Create: `routes/storage.js`（先实现 `POST /save-media`）
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`（下载媒体时同步保存）
- Test: `tests/storage-media.test.js`

**Interfaces:**
- Consumes: `projectDir`、`getStorageRoot`（Task 1）
- Produces: `POST /api/storage/save-media`：`{ projectName, category('image'|'video'|'audio'), filename, dataUrl }` → `{ saved: true, path } | { saved: false, reason? }`

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-media.test.js
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorageRouter } = require('../routes/storage');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); }); });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

test('save-media writes a data URL image into project 图片 folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-media-'));
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const app = createStorageRouter({ auth: (req, res, next) => { req.username = 'tester'; next(); }, getStorageRootFn: () => root });
    const res = await request(app, { requestPath: '/api/storage/save-media', body: { projectName: '水火项目', category: 'image', filename: 'shot.png', dataUrl: `data:image/png;base64,${png}` } });
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, true);
    const file = path.join(root, '制作工程', '水火项目', '图片', 'shot.png');
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.readFileSync(file).toString('base64'), png);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('save-media rejects invalid category', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-media2-'));
  try {
    const app = createStorageRouter({ auth: (req, res, next) => { req.username = 'tester'; next(); }, getStorageRootFn: () => root });
    const res = await request(app, { requestPath: '/api/storage/save-media', body: { projectName: 'p', category: 'other', filename: 'x.png', dataUrl: 'data:image/png;base64,AAAA' } });
    assert.equal(res.status, 400);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-media.test.js`
Expected: FAIL（`routes/storage.js` 不存在）

- [ ] **Step 3: 实现 routes/storage.js**

```js
// routes/storage.js
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { apiAuth } = require('../middleware/auth');
const { getStorageRoot, projectDir } = require('../lib/storage-root');

const CATEGORY_DIR = { image: '图片', video: '视频', audio: '配音' };

function createStorageRouter({ auth = apiAuth, getStorageRootFn = getStorageRoot } = {}) {
  const router = express.Router();
  router.use(auth);
  router.post('/save-media', (req, res) => {
    const { projectName, category, filename, dataUrl } = req.body || {};
    const dirName = CATEGORY_DIR[category];
    if (!dirName || !projectName || !filename || !dataUrl) {
      return res.status(400).json({ error: 'projectName/category/filename/dataUrl 均必填' });
    }
    const root = getStorageRootFn(req.username || '');
    if (!root) return res.json({ saved: false, reason: '未配置本地存储文件夹' });
    const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl));
    if (!match) return res.status(400).json({ error: 'dataUrl 必须是 base64 data URL' });
    const dir = path.join(projectDir(root, projectName), dirName);
    const file = path.join(dir, path.basename(String(filename)));
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    res.json({ saved: true, path: file });
  });
  return router;
}

module.exports = { createStorageRouter };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/storage-media.test.js`
Expected: PASS（2/2）

- [ ] **Step 5: 前端 StudioView 下载时同步保存**

在 `frontend/src/user/pages/shuihuo/StudioView.jsx` 的媒体下载逻辑（约 108-118 行 blob 下载处）追加：把 `blob` 转 `dataUrl`（`FileReader`），POST `/api/storage/save-media`，携带 `projectName`（当前项目名，从项目列表数据取）、`category`（image/video）、`filename`；成功静默提示「已保存到 制作工程/<项目>」。若 `saved:false` 不提示（未配置时保持原行为）。

- [ ] **Step 6: 提交**

```bash
git add routes/storage.js frontend/src/user/pages/shuihuo/StudioView.jsx tests/storage-media.test.js
git commit -m "feat: save shuihuo media into local project folder on download"
```

---

### Task 8: 恢复机制（list + restore）+ 历史详情回落

**Files:**
- Modify: `lib/storage-root.js`（新增 `scanDir(dir) → [{name,size}]`、`scanStorage(root) → list`）
- Modify: `routes/storage.js`（追加 `GET /list`、`POST /restore`；依赖注入 `historyHasFn`/`historyAddFn`）
- Modify: `routes/history.js`（`GET /api/history/:id` 缺失时回落本地 md；导出 `historyHasId`/`historyAppend` 供恢复用）
- Modify: `frontend/src/user/pages/SettingsPage.jsx`（恢复报告 + 清单展示）
- Test: `tests/storage-restore.test.js`

**Interfaces:**
- Consumes: `featureDir`、`FEATURE_*`（Task 1）
- Produces:
  - `scanDir(dir) → [{ name, size }]`、`scanStorage(root) → { scriptResults, novelFetch, novelAdapt, projects }`
  - `GET /api/storage/list` → `scanStorage` 结果
  - `POST /api/storage/restore` → `{ scriptResults:{found,added}, novelFetch:{found}, novelAdapt:{found}, projects:{found}, errors:[] }`

- [ ] **Step 1: 写失败测试**

```js
// tests/storage-restore.test.js
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorageRouter } = require('../routes/storage');
const { featureDir, scanStorage } = require('../lib/storage-root');

function request(app, { method = 'GET', requestPath } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: requestPath, method }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); });
      });
      req.once('error', reject); req.end();
    });
  });
}

test('scanStorage returns contents of each feature folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-list-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'a.md'), '# a');
    fs.writeFileSync(path.join(featureDir(root, '小说获取'), '111.txt'), 'txt');
    fs.writeFileSync(path.join(featureDir(root, '改编小说'), '111.txt'), 'adapt');
    fs.writeFileSync(path.join(root, '制作工程', '剧集A', '输出结果.md'), 'md');
    const list = scanStorage(root);
    assert.equal(list.scriptResults.length, 1);
    assert.equal(list.scriptResults[0].name, 'a.md');
    assert.equal(list.novelFetch.length, 1);
    assert.equal(list.novelAdapt.length, 1);
    assert.equal(list.projects.length, 1);
    assert.equal(list.projects[0].name, '剧集A');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restore reports found files and merges script md into history index', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-restore-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'r1.md'), '# 标题\n正文');
    const merged = [];
    const app = createStorageRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      getStorageRootFn: () => root,
      historyHasFn: () => false,
      historyAddFn: (username, record) => { merged.push(record); return true; }
    });
    const res = await request(app, { method: 'POST', requestPath: '/api/storage/restore' });
    assert.equal(res.status, 200);
    assert.equal(res.body.scriptResults.found, 1);
    assert.equal(res.body.scriptResults.added, 1);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'r1');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restore is idempotent when record already exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-restore2-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'r1.md'), 'x');
    const app = createStorageRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      getStorageRootFn: () => root,
      historyHasFn: () => true,
      historyAddFn: () => { throw new Error('不应重复添加'); }
    });
    const res = await request(app, { method: 'POST', requestPath: '/api/storage/restore' });
    assert.equal(res.status, 200);
    assert.equal(res.body.scriptResults.added, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/storage-restore.test.js`
Expected: FAIL（`scanStorage` 未导出；`GET /list`、`POST /restore` 不存在）

- [ ] **Step 3: 实现 scanStorage**

在 `lib/storage-root.js` 追加：

```js
function scanDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
}

function scanStorage(root) {
  const productionRoot = path.join(root, FEATURE_PRODUCTION);
  const projects = [];
  if (fs.existsSync(productionRoot)) {
    for (const entry of fs.readdirSync(productionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      projects.push({ name: entry.name, files: scanDir(path.join(productionRoot, entry.name)) });
    }
  }
  return {
    scriptResults: scanDir(path.join(root, FEATURE_SCRIPT)),
    novelFetch: scanDir(path.join(root, FEATURE_NOVEL_FETCH)),
    novelAdapt: scanDir(path.join(root, FEATURE_NOVEL_ADAPT)),
    projects
  };
}
```

加入 `module.exports`。

- [ ] **Step 4: 接线 routes/storage.js 追加 list/restore**

`createStorageRouter({ auth, getStorageRootFn, historyHasFn, historyAddFn })`（后两者缺省回落 `routes/history` 导出的实现）：

```js
const { scanStorage, FEATURE_SCRIPT } = require('../lib/storage-root');

router.get('/list', (req, res) => {
  const root = getStorageRootFn(req.username || '');
  res.json(root ? scanStorage(root) : { scriptResults: [], novelFetch: [], novelAdapt: [], projects: [] });
});

router.post('/restore', (req, res) => {
  const username = req.username || '';
  const root = getStorageRootFn(username);
  if (!root) return res.json({ scriptResults: { found: 0, added: 0 }, novelFetch: { found: 0 }, novelAdapt: { found: 0 }, projects: { found: 0 }, errors: [] });
  const errors = [];
  const scriptDir = path.join(root, FEATURE_SCRIPT);
  let added = 0;
  for (const f of scanDir(scriptDir)) {
    if (!f.name.endsWith('.md')) continue;
    const id = f.name.slice(0, -3);
    if (historyHasFn(username, id)) continue;
    try {
      const content = fs.readFileSync(path.join(scriptDir, f.name), 'utf8');
      const firstLine = content.split('\n')[0] || id;
      historyAddFn(username, { id, title: firstLine.replace(/^#+\s*/, '').trim() || id, restoredFrom: 'local', createdAt: fs.statSync(path.join(scriptDir, f.name)).mtimeMs });
      added += 1;
    } catch (error) { errors.push(`剧本生成/${f.name}: ${error.message}`); }
  }
  res.json({
    scriptResults: { found: scanDir(scriptDir).filter(f => f.name.endsWith('.md')).length, added },
    novelFetch: { found: scanDir(path.join(root, '小说获取')).length },
    novelAdapt: { found: scanDir(path.join(root, '改编小说')).length },
    projects: { found: fs.existsSync(path.join(root, '制作工程')) ? fs.readdirSync(path.join(root, '制作工程'), { withFileTypes: true }).filter(e => e.isDirectory()).length : 0 },
    errors
  });
});
```

（`scanDir` 在 restore 中用 `require` 到路由内或从 storage-root 导入。）

- [ ] **Step 5: routes/history.js 导出 + 详情回落**

- 在 `routes/history.js` 末尾导出 `module.exports.historyHasId = historyHasId;`、`module.exports.historyAppend = historyAppend;`（实现取现有 index 读取/写入逻辑的封装：`historyHasId(username, id)` 判断 index 是否含该 id；`historyAppend(username, record)` 追加并写回 index.json，上限 50 条与现有 saveHistory 一致）。
- `GET /api/history/:id`：当 outputs 目录无 `<id>.txt` 时，若 `getStorageRoot` 配置且 `<root>/剧本生成/<id>.md` 存在，返回该 md 正文（`Content-Type: text/plain`），并在响应头或正文加 `（恢复自本地文件夹）` 提示。

- [ ] **Step 6: 前端设置页接入恢复**

在 `frontend/src/user/pages/SettingsPage.jsx`：把「恢复」按钮接到 `POST /api/storage/restore` 展示报告；「查看文件清单」接到 `GET /api/storage/list`，用 antd `List`/`Table` 展示各目录与项目文件。

- [ ] **Step 7: 回归 + 提交**

Run: `node --test tests/storage-restore.test.js tests/storage-media.test.js tests/governance-routes.test.js tests/seed-accounts.test.js`
Expected: PASS

```bash
git add lib/storage-root.js routes/storage.js routes/history.js frontend/src/user/pages/SettingsPage.jsx tests/storage-restore.test.js
git commit -m "feat: storage list and restore scan with history index merge"
```

---

### Task 9: app.js 挂载 + 前端构建 + 全量回归

**Files:**
- Modify: `app.js`（挂载 `createStorageRouter` 到 `/api/storage`）

- [ ] **Step 1: 挂载路由**

在 `app.js` 中鉴权相关路由之后追加：

```js
const { createStorageRouter } = require('./routes/storage');
// 在 apiAuth 可用的路由区：
app.use('/api/storage', createStorageRouter());
```

（`createStorageRouter` 默认 `auth = apiAuth`，与其它 `/api` 路由一致。）

- [ ] **Step 2: 前端构建验证**

Run: `npm run build`（在 `frontend/` 目录）
Expected: 构建成功，无报错

- [ ] **Step 3: 全量测试回归**

Run: `node --test tests\*.test.js`
Expected: 与基线一致（8 个既有失败项，无新增失败）；新增 `tests/storage-*.test.js` 全绿。

- [ ] **Step 4: 冒烟验证**

启动 `node server.js`：
- 设置页填写本地文件夹保存 → GET /api/config 返回 storageRoot。
- 剧本生成一条 → `<root>/剧本生成/<id>.md` 出现。
- 小说获取点下载 → `<root>/小说获取/<bookId>.txt` 出现。
- 设置页「恢复」→ 返回找到的文件数与报告。

- [ ] **Step 5: 提交**

```bash
git add app.js
git commit -m "feat: mount storage router and wire local storage folder end to end"
```

---

## Self-Review 记录

- **Spec 覆盖**：设置项(§3)→Task 1/2；存储结构(§2)→Task 1；剧本生成(§5.1)→Task 3；小说获取/改编(§5.2)→Task 4；小说面板导出(§5.3)→Task 5；水火图片/视频(§5.4)→Task 7；剪映(§5.5)→Task 1 `projectDir` 建 `剪映/` 占位；配音(§5.6)→Task 6；恢复(§6)→Task 8；错误处理(§7)→各 helper 失败返回 null/false 不阻断主流程；测试(§8)→各任务测试。
- **与现有架构一致**：`config/history/novel-panel/tts` 保持普通 router，仅薄接线；核心逻辑抽到 `lib/storage-root.js` 纯函数，全部 TDD。
- **剪映**：无真实工程逻辑，`projectDir` 建目录占位即可（Task 1 已含）。
- **水火跨机**：本期通过前端 blob → data URL → `/api/storage/save-media` 落盘，不依赖 Go 内部目录，天然规避跨机问题。
- **恢复并入历史索引**：Task 8 通过 `historyHasFn/historyAddFn` 注入 + 详情读取回落本地文件实现，幂等（`historyHasFn` 去重）。
- **TTS 缓冲**：由 pipe 改为缓冲后回写，仅当 `projectName` 且配置了根目录时落盘，否则保持透传语义。
