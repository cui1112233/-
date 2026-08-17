# 小说获取功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「一战晟铭」前端新增「小说获取」页面，通过后端代理 `txt.121w.com/api.php` 按书籍 ID 批量获取小说正文，支持平台选择、字数选择、逐本查看/复制/下载、单选/全选与批量操作。

**Architecture:** 后端新增 Express 路由 `routes/novel-fetch.js`（工厂函数、可注入上游抓取器与鉴权中间件）并发代理到 `https://txt.121w.com/api.php`，避免浏览器跨域；前端新增 React 页面 `NovelFetchPage.jsx` 与 API 模块，接入现有 React 路由与 lucide 导航。

**Tech Stack:** Node.js + Express（后端代理）、React + Ant Design + lucide-react（前端）、node:test（测试）。

## Global Constraints

- 平台映射（前端与后端各维护一份，必须一致）：
  - 黑岩付费=1、番茄付费=2、七猫付费=3、点众付费=4、番茄免费=7、知乎付费=15、掌阅付费=20、卓越付费=26、九州书城=29、掌文付费=31
- 书籍 ID：1–20 位数字字符串；批量上限 50 个；解析按换行/逗号/空格/分号分隔，去重去空。
- `max_txt`：100–100000 的整数；前端下拉选项 500/1000/2000/3000/5000/10000 + 自定义；默认 2000。
- 上游判定：`upstream.code === 200` 且 `upstream.data` 为非空字符串 → 成功；否则失败，`error` 取 `upstream.msg`。
- 上游单个请求超时 20s。
- 后端路由挂载路径：`POST /api/novel-fetch`，鉴权与 `routes/tts.js` 一致使用 `apiAuth`。
- 页面路由：`/novel-fetch`；导航图标 `BookOpen`（size 18、strokeWidth 1.8），位于「剧本生成」之后。
- 语言：界面文案使用中文；代码注释使用中文。
- 测试命令：`node --test tests/`；前端构建命令：`npm --prefix frontend run build`。

---

### Task 1: 后端小说获取路由

**Files:**
- Create: `routes/novel-fetch.js`
- Test: `tests/novel-fetch-routes.test.js`

**Interfaces:**
- Consumes: `../middleware/auth` 的 `apiAuth`（存在）；`express`。
- Produces:
  - `createNovelFetchRouter({ fetchUpstream, auth } = {})` → Express Router，挂载 `POST /`。
  - 默认 `fetchUpstream(bookId, platform, maxTxt)` → `Promise<{ code, msg, data }>`（走真实 https）。
  - 导出常量 `PLATFORMS`（`[{ id, name }]`，10 项）。
  - 请求体 `{ platform: number, bookIds: string[], maxTxt: number }`；响应 `{ results: [{ bookId, platform, platformName, status: 'ok'|'error', data, error, length }] }`。

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'GET', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function makeApp(fetchUpstream) {
  const app = express();
  app.use(express.json());
  app.use('/api/novel-fetch', createNovelFetchRouter({ fetchUpstream, auth: (req, res, next) => next() }));
  return app;
}

test('novel-fetch proxies per book and maps success/error', async () => {
  const calls = [];
  const fetchUpstream = async (bookId, platform, maxTxt) => {
    calls.push({ bookId, platform, maxTxt });
    if (bookId === '1') return { code: 200, msg: '获取章节内容成功', data: '正文内容' };
    return { code: 400, msg: '获取书籍信息失败', data: null };
  };
  const result = await request(makeApp(fetchUpstream), {
    method: 'POST',
    requestPath: '/api/novel-fetch',
    body: { platform: 2, bookIds: ['1', '2'], maxTxt: 2000 }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 2);
  assert.equal(result.body.results[0].bookId, '1');
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[0].data, '正文内容');
  assert.equal(result.body.results[0].length, '正文内容'.length);
  assert.equal(result.body.results[0].platformName, '番茄付费');
  assert.equal(result.body.results[1].status, 'error');
  assert.equal(result.body.results[1].error, '获取书籍信息失败');
  assert.deepEqual(calls, [
    { bookId: '1', platform: 2, maxTxt: 2000 },
    { bookId: '2', platform: 2, maxTxt: 2000 }
  ]);
});

test('novel-fetch rejects invalid input', async () => {
  const app = makeApp(async () => ({ code: 200, data: 'x' }));
  const cases = [
    { platform: 999, bookIds: ['1'], maxTxt: 2000 },
    { platform: 2, bookIds: [], maxTxt: 2000 },
    { platform: 2, bookIds: ['abc'], maxTxt: 2000 },
    { platform: 2, bookIds: ['1'], maxTxt: 1 }
  ];
  for (const body of cases) {
    const result = await request(app, { method: 'POST', requestPath: '/api/novel-fetch', body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('novel-fetch catches upstream exceptions per book', async () => {
  const fetchUpstream = async () => { throw new Error('网络异常'); };
  const result = await request(makeApp(fetchUpstream), {
    method: 'POST',
    requestPath: '/api/novel-fetch',
    body: { platform: 2, bookIds: ['1'], maxTxt: 2000 }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'error');
  assert.match(result.body.results[0].error, /网络异常/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/novel-fetch-routes.test.js`
Expected: FAIL，报 `Cannot find module '../routes/novel-fetch'` 或 `createNovelFetchRouter is not a function`。

- [ ] **Step 3: 实现路由**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/novel-fetch-routes.test.js`
Expected: PASS，3 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add routes/novel-fetch.js tests/novel-fetch-routes.test.js
git commit -m "feat: add novel fetch backend proxy route"
```

---

### Task 2: 后端接线（挂载路由 + 页面路由）

**Files:**
- Modify: `app.js`（导入与挂载路由）
- Modify: `routes/pages.js`（新增 `/novel-fetch` 页面路由）

**Interfaces:**
- Consumes: Task 1 的 `createNovelFetchRouter`（`routes/novel-fetch`）。
- Produces: `POST /api/novel-fetch` 生效；浏览器访问 `/novel-fetch` 返回 React 入口。

- [ ] **Step 1: 修改 `app.js`**

在路由引入区域（`novelPanelApiRouter` 附近）新增：

```js
const { createNovelFetchRouter } = require('./routes/novel-fetch');
```

在路由挂载区域新增（放在 `app.use('/api/novel-panel', novelPanelApiRouter);` 之后）：

```js
app.use('/api/novel-fetch', createNovelFetchRouter());
```

- [ ] **Step 2: 修改 `routes/pages.js`**

在 `router.get('/novel-panel', ...)` 之后新增：

```js
router.get('/novel-fetch', serveReactEntry('index.html', 'index.html'));
```

- [ ] **Step 3: 验证接线**

Run: `node -e "const fs=require('fs');const a=fs.readFileSync('app.js','utf8');const p=fs.readFileSync('routes/pages.js','utf8');if(!a.includes(\"app.use('/api/novel-fetch'\")||!p.includes(\"router.get('/novel-fetch'\"))process.exit(1);console.log('wired ok')"`
Expected: 输出 `wired ok`。

- [ ] **Step 4: 启动服务器冒烟验证接口**

Run（后台）：`node server.js`
然后另开终端执行：`curl -s -X POST http://127.0.0.1:3000/api/novel-fetch -H "Content-Type: application/json" -d '{"platform":2,"bookIds":["bad"],"maxTxt":200}'`
Expected: 返回 `401`（未登录，鉴权生效）。验证后停止服务器。

- [ ] **Step 5: 提交**

```bash
git add app.js routes/pages.js
git commit -m "feat: wire novel fetch route and page"
```

---

### Task 3: 前端 API 模块

**Files:**
- Create: `frontend/src/shared/api/novelFetch.js`

**Interfaces:**
- Consumes: `./client` 的 `apiRequest`（存在，自动带 Bearer token）。
- Produces: `fetchNovelContent({ platform, bookIds, maxTxt })` → `Promise<{ results }>`，供 Task 4 使用。

- [ ] **Step 1: 实现 API 模块**

```js
import { apiRequest } from './client';

export function fetchNovelContent({ platform, bookIds, maxTxt }) {
  return apiRequest('/api/novel-fetch', {
    method: 'POST',
    body: JSON.stringify({ platform, bookIds, maxTxt })
  });
}
```

- [ ] **Step 2: 验证文件存在且导出正确**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/src/shared/api/novelFetch.js','utf8');if(!s.includes('export function fetchNovelContent')||!s.includes('/api/novel-fetch'))process.exit(1);console.log('api module ok')"`
Expected: 输出 `api module ok`。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/shared/api/novelFetch.js
git commit -m "feat: add novel fetch frontend api module"
```

---

### Task 4: 前端小说获取页面

**Files:**
- Create: `frontend/src/user/pages/NovelFetchPage.jsx`

**Interfaces:**
- Consumes: Task 3 的 `fetchNovelContent`。
- Produces: 默认导出 `NovelFetchPage`，供 Task 5 的路由映射使用；页面内包含平台下拉（10 项）、书籍 ID 批量解析、字数选择（含自定义）、逐本查看/复制/下载、全选、批量复制/下载、失败重试。

- [ ] **Step 1: 实现页面组件**

```jsx
import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from 'antd';
import { Copy, Download, Eye, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { fetchNovelContent } from '../../shared/api/novelFetch';

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

const WORD_COUNTS = [500, 1000, 2000, 3000, 5000, 10000];
const MAX_BOOK_IDS = 50;

function parseBookIds(text) {
  const values = String(text || '')
    .split(/[\s,，;；]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function resolveMaxTxt(form, customWordCount) {
  const value = form.getFieldValue('maxTxt');
  if (customWordCount) return Number(form.getFieldValue('customMaxTxt'));
  return Number(value);
}

export function NovelFetchPage() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState([]);
  const [customWordCount, setCustomWordCount] = useState(false);
  const [preview, setPreview] = useState(null);
  const [retrying, setRetrying] = useState(false);

  async function handleFetch() {
    const bookIds = parseBookIds(form.getFieldValue('bookIdsText'));
    if (bookIds.length === 0) { message.warning('请填写书籍 ID'); return; }
    if (bookIds.length > MAX_BOOK_IDS) { message.warning(`一次最多获取 ${MAX_BOOK_IDS} 本书`); return; }
    const maxTxt = resolveMaxTxt(form, customWordCount);
    if (!Number.isInteger(maxTxt) || maxTxt < 100 || maxTxt > 100000) { message.warning('字数需为 100–100000 的整数'); return; }
    const platformId = Number(form.getFieldValue('platformId'));
    const platformName = PLATFORMS.find(p => p.id === platformId)?.name || '';
    const initialRows = bookIds.map(bookId => ({ bookId, platform: platformId, platformName, status: 'loading', data: null, error: null, length: 0 }));
    setRows(initialRows);
    setSelected([]);
    setFetching(true);
    try {
      const data = await fetchNovelContent({ platform: platformId, bookIds, maxTxt });
      const byId = new Map((data.results || []).map(item => [item.bookId, item]));
      setRows(initialRows.map(row => {
        const result = byId.get(row.bookId);
        return result
          ? { ...row, status: result.status, data: result.data, error: result.error, length: result.length }
          : { ...row, status: 'error', error: '无返回结果', length: 0 };
      }));
      const failed = (data.results || []).filter(item => item.status === 'error').length;
      if (failed) message.error(`${failed} 本获取失败`);
      else message.success('全部获取成功');
    } catch (error) {
      setRows(initialRows.map(row => ({ ...row, status: 'error', error: error.message || '请求失败', length: 0 })));
      message.error(error.message || '获取失败');
    } finally {
      setFetching(false);
    }
  }

  async function handleRetry(row) {
    setRetrying(true);
    try {
      const maxTxt = resolveMaxTxt(form, customWordCount);
      const data = await fetchNovelContent({ platform: row.platform, bookIds: [row.bookId], maxTxt });
      const result = (data.results || [])[0];
      setRows(rows.map(item => item.bookId === row.bookId
        ? { ...item, status: result.status, data: result.data, error: result.error, length: result.length }
        : item));
      message[result.status === 'ok' ? 'success' : 'error'](result.status === 'ok' ? '重试成功' : (result.error || '重试失败'));
    } catch (error) {
      message.error(error.message || '重试失败');
    } finally {
      setRetrying(false);
    }
  }

  function handleReset() {
    form.resetFields();
    setRows([]);
    setSelected([]);
    setPreview(null);
    setCustomWordCount(false);
  }

  function toggleRow(bookId) {
    setSelected(current => current.includes(bookId) ? current.filter(id => id !== bookId) : [...current, bookId]);
  }

  function okRows() {
    return rows.filter(row => row.status === 'ok');
  }

  function toggleAll() {
    const oks = okRows();
    setSelected(current => current.length === oks.length ? [] : oks.map(row => row.bookId));
  }

  async function handleBatchCopy() {
    const chosen = rows.filter(row => selected.includes(row.bookId));
    if (chosen.length === 0) { message.warning('请先选择要复制的书籍'); return; }
    const text = chosen.map(row => `bookid：${row.bookId} —— ${row.platformName}\n\n${row.data}`).join('\n\n----------------\n\n');
    await copyText(text);
    message.success(`已复制 ${chosen.length} 本内容`);
  }

  function handleBatchDownload() {
    const chosen = rows.filter(row => selected.includes(row.bookId));
    if (chosen.length === 0) { message.warning('请先选择要下载的书籍'); return; }
    chosen.forEach(row => downloadText(`${row.bookId}.txt`, row.data));
  }

  return (
    <Space className="novel-fetch-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>小说获取</Typography.Title>
      <Form
        form={form}
        layout="inline"
        initialValues={{ platformId: 2, maxTxt: 2000 }}
        className="novel-fetch-form"
      >
        <Form.Item name="platformId" label="平台">
          <Select style={{ width: 160 }} options={PLATFORMS.map(p => ({ value: p.id, label: p.name }))} />
        </Form.Item>
        <Form.Item name="bookIdsText" label="书籍 ID" style={{ minWidth: 300, flex: 1 }}>
          <Input.TextArea
            rows={2}
            placeholder={'每行一个书籍 ID，支持逗号/空格分隔\n例：7673480334440139800'}
          />
        </Form.Item>
        <Form.Item name="maxTxt" label="字数">
          <Select
            style={{ width: 130 }}
            options={[
              ...WORD_COUNTS.map(n => ({ value: n, label: String(n) })),
              { value: 'custom', label: '自定义' }
            ]}
            onChange={(value) => setCustomWordCount(value === 'custom')}
          />
        </Form.Item>
        {customWordCount ? (
          <Form.Item name="customMaxTxt" label="自定义字数">
            <InputNumber min={100} max={100000} style={{ width: 120 }} />
          </Form.Item>
        ) : null}
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="button" loading={fetching} onClick={handleFetch}>获取</Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      {rows.length > 0 ? (
        <div className="legacy-panel-card novel-fetch-results">
          <div className="novel-fetch-toolbar">
            <Checkbox
              checked={okRows().length > 0 && selected.length === okRows().length}
              disabled={okRows().length === 0}
              onChange={toggleAll}
            >
              全选
            </Checkbox>
            <Button size="small" icon={<Copy size={14} aria-hidden="true" />} onClick={handleBatchCopy}>批量复制</Button>
            <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={handleBatchDownload}>批量下载</Button>
          </div>
          {rows.map(row => (
            <div key={row.bookId} className="novel-fetch-row">
              <Checkbox
                checked={selected.includes(row.bookId)}
                disabled={row.status !== 'ok'}
                onChange={() => toggleRow(row.bookId)}
              />
              <span className="novel-fetch-bookid">{row.bookId}</span>
              <span className="novel-fetch-platform">{row.platformName}</span>
              <span className={`novel-fetch-status novel-fetch-status--${row.status}`}>
                {row.status === 'loading' ? '获取中…' : row.status === 'ok' ? '成功' : '失败'}
              </span>
              <span className="novel-fetch-length">
                {row.status === 'ok' ? `${row.length} 字` : (row.error || '')}
              </span>
              <Space className="novel-fetch-actions">
                {row.status === 'ok' ? (
                  <>
                    <Button size="small" icon={<Eye size={14} aria-hidden="true" />} onClick={() => setPreview(row)}>查看</Button>
                    <Button size="small" icon={<Download size={14} aria-hidden="true" />} onClick={() => downloadText(`${row.bookId}.txt`, row.data)}>下载</Button>
                  </>
                ) : row.status === 'error' ? (
                  <Button size="small" icon={<RotateCcw size={14} aria-hidden="true" />} loading={retrying} onClick={() => handleRetry(row)}>重试</Button>
                ) : null}
              </Space>
            </div>
          ))}
        </div>
      ) : null}

      <Modal
        title={preview ? `${preview.bookId} — ${preview.platformName}` : ''}
        open={Boolean(preview)}
        width={860}
        footer={[
          <Button key="copy" icon={<Copy size={14} aria-hidden="true" />} onClick={() => { if (preview) copyText(preview.data); message.success('已复制到剪贴板'); }}>复制</Button>,
          <Button key="close" onClick={() => setPreview(null)}>关闭</Button>
        ]}
        onCancel={() => setPreview(null)}
      >
        <Input.TextArea value={preview ? preview.data : ''} rows={18} readOnly className="novel-fetch-preview" />
      </Modal>
    </Space>
  );
}

export default NovelFetchPage;
```

- [ ] **Step 2: 验证页面文件关键结构**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/src/user/pages/NovelFetchPage.jsx','utf8');const checks=['PLATFORMS','黑岩付费','掌文付费','parseBookIds','WORD_COUNTS','自定义','fetchNovelContent','全选','批量复制','批量下载','查看','下载','重试'];for(const c of checks){if(!s.includes(c)){console.error('missing: '+c);process.exit(1);}}console.log('page structure ok')"`
Expected: 输出 `page structure ok`。（注：`BookOpen` 导航图标校验在 Task 5 进行，本任务不涉及导航。）

- [ ] **Step 3: 提交**

```bash
git add frontend/src/user/pages/NovelFetchPage.jsx
git commit -m "feat: add novel fetch page"
```

---

### Task 5: 前端接线（路由 + 导航）

**Files:**
- Modify: `frontend/src/user/App.jsx`（路由映射）
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`（导航项与图标）

**Interfaces:**
- Consumes: Task 4 的默认导出 `NovelFetchPage`。
- Produces: 访问 `/novel-fetch` 渲染小说获取页；侧边栏出现「小说获取」项（lucide `BookOpen` 图标）。

- [ ] **Step 1: 修改 `App.jsx`**

在 `const TtsPage = ...` 附近新增导入：

```js
const NovelFetchPage = lazy(() => import('./pages/NovelFetchPage'));
```

在 `getPage` 的 `routes` 对象中新增：

```js
'/novel-fetch': NovelFetchPage,
```

（放在 `/script` 之后一行。）

- [ ] **Step 2: 修改 `UserLayout.jsx`**

在 lucide 导入中新增 `BookOpen`：

```js
import { AudioLines, BookOpen, Bot, ... } from 'lucide-react';
```

在 `navItems` 中，`/script` 项之后新增：

```js
{ href: '/novel-fetch', icon: BookOpen, label: '小说获取' },
```

- [ ] **Step 3: 前端构建验证**

Run: `npm --prefix frontend run build`
Expected: 构建成功，无报错。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/user/App.jsx frontend/src/shared/layouts/UserLayout.jsx
git commit -m "feat: wire novel fetch route and nav"
```

---

### Task 6: 契约测试与整体验证

**Files:**
- Create: `tests/novel-fetch-contract.test.js`

**Interfaces:**
- Consumes: Task 1–5 的全部产出。
- Produces: 全量测试与构建通过的验证。

- [ ] **Step 1: 写契约测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('novel fetch backend route is wired and validates input', () => {
  const app = read('app.js');
  const pages = read('routes/pages.js');
  const route = read('routes/novel-fetch.js');

  assert.match(app, /app\.use\('\/api\/novel-fetch', createNovelFetchRouter\(\)\)/);
  assert.match(pages, /router\.get\('\/novel-fetch', serveReactEntry\('index\.html', 'index\.html'\)\)/);
  assert.match(route, /createNovelFetchRouter/);
  assert.match(route, /platformNameById/);
  assert.match(route, /const numericPlatform = Number\(platform\)/);
  assert.match(route, /bookIds\.length > MAX_BOOK_IDS/);
  assert.match(route, /\\d\{1,20\}/);
  assert.match(route, /numericMaxTxt < 100 \|\| numericMaxTxt > 100000/);
  assert.match(route, /upstream\.code === 200/);
  assert.match(route, /status: 'ok'/);
  assert.match(route, /status: 'error'/);
});

test('novel fetch page exposes platform options, batch ids, word count, and actions', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  const api = read('frontend/src/shared/api/novelFetch.js');
  const app = read('frontend/src/user/App.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');

  const names = ['黑岩付费', '番茄付费', '七猫付费', '点众付费', '番茄免费', '知乎付费', '掌阅付费', '卓越付费', '九州书城', '掌文付费'];
  const ids = [1, 2, 3, 4, 7, 15, 20, 26, 29, 31];
  for (let i = 0; i < names.length; i++) {
    assert.match(page, new RegExp(`id: ${ids[i]}, name: '${names[i]}'`));
  }
  assert.match(page, /parseBookIds/);
  assert.match(page, /split\(\/\[\\s,，;；\]\+\/\)/);
  assert.match(page, /WORD_COUNTS/);
  assert.match(page, /value: 'custom'/);
  assert.match(page, /fetchNovelContent/);
  assert.match(page, /全选/);
  assert.match(page, /批量复制/);
  assert.match(page, /批量下载/);
  assert.match(page, />查看</);
  assert.match(page, />下载</);
  assert.match(page, />重试</);
  assert.match(page, /novel-fetch-status--\$\{row\.status\}/);
  assert.match(api, /fetchNovelContent/);
  assert.match(api, /\/api\/novel-fetch/);
  assert.match(app, /'\/novel-fetch': NovelFetchPage/);
  assert.match(layout, /href: '\/novel-fetch'/);
  assert.match(layout, /icon: BookOpen/);
});
```

- [ ] **Step 2: 运行全部测试**

Run: `node --test tests\*.test.js`
（注：Windows + Node 24 下 `node --test tests/` 会把目录当模块报 `Cannot find module`，使用通配形式等效运行全量测试。）
Expected: 全部测试通过（含新增两个测试文件 `novel-fetch-contract.test.js` 与既有 `novel-fetch-routes.test.js`）。若存在与本任务无关的既有测试失败（如通知设置、配音音效、小说面板等他人 WIP 相关），记录但不修改。

- [ ] **Step 3: 前端生产构建**

Run: `npm --prefix frontend run build`
Expected: 构建成功。

- [ ] **Step 4: 端到端冒烟（可选）**

若服务器可启动：`node server.js` 后浏览器访问 `http://127.0.0.1:3000/novel-fetch`，登录后填写一个已知书 ID（如 `7673480334440139800`）与平台「番茄付费」，点击获取，应出现成功行并可查看/复制/下载。

- [ ] **Step 5: 提交**

```bash
git add tests/novel-fetch-contract.test.js
git commit -m "test: add novel fetch contract coverage"
```

---

## Self-Review 记录

- Spec 覆盖：导航/路由（Task 2、5）、表单平台 10 项（Task 1 常量 + Task 4 页面）、批量 ID 解析（Task 4 `parseBookIds`）、字数选择含自定义（Task 4）、逐本查看/复制/下载（Task 4）、全选/批量复制/批量下载（Task 4）、失败重试（Task 4 `handleRetry`）、后端校验与并发代理（Task 1）、契约测试（Task 6）。无遗漏。
- 占位符检查：无 TBD/TODO；每个代码步骤都给出实际内容。
- 类型一致性：`fetchNovelContent({ platform, bookIds, maxTxt })`、`createNovelFetchRouter({ fetchUpstream, auth })`、响应 `results[{ bookId, platform, platformName, status, data, error, length }]` 在任务间一致。
