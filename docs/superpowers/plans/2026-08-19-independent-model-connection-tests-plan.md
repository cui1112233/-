# 独立模型连接测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页提供文本模型和 OpenAI 兼容生图模型各自独立、互不串用配置的连接测试。

**Architecture:** 保留文本 Chat Completions 测试并将其显式挂到 `/api/test/text`，兼容保留旧 `/api/test`。在共享 Node 上游传输层增加 GET Models 请求，使图片测试可以用图片配置的 Base URL、Key 和模型名验证鉴权与模型目录，而不触发图片生成。React 维护两个独立 loading 状态，测试永远只提交当前表单值，不写入账号配置。

**Tech Stack:** Node.js, Express, native `http`/`https`, `https-proxy-agent`, React, Ant Design, Node test runner, Vite.

---

### Task 1: 为 Models 目录请求建立共享传输契约

**Files:**
- Modify: `lib/shared.js:228-350`
- Modify: `tests/upstream-proxy.test.js`

- [ ] **Step 1: 写失败测试，定义 Models URL 和独立 GET 请求入口**

```js
const { buildModelsUrl, requestUpstreamModels } = require('../lib/shared');

test('buildModelsUrl normalizes OpenAI-compatible base URLs', () => {
  assert.equal(buildModelsUrl('https://gateway.example/v1'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example/v1/'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example'), 'https://gateway.example/v1/models');
  assert.throws(() => buildModelsUrl(''), /Base URL is required/);
});

test('image model catalog lookup uses a GET request and does not require a prompt body', async () => {
  // Start a local HTTP server and assert method === 'GET', URL === '/v1/models',
  // and Authorization is present, then resolve its JSON response through requestUpstreamModels.
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/upstream-proxy.test.js`

Expected: FAIL，因为 `buildModelsUrl` 和 `requestUpstreamModels` 尚未导出。

- [ ] **Step 3: 抽取不依赖 Chat 的通用请求函数**

在 `lib/shared.js` 增加 `buildModelsUrl(baseUrl)`，并将当前超时、AbortSignal、代理、TLS 曲线和响应结算逻辑移入：

```js
function requestUpstreamUrl(rawUrl, { method, apiKey, body }, onResponse, options = {}) {
  const targetUrl = new URL(rawUrl);
  const transport = targetUrl.protocol === 'http:' ? http : https;
  const proxyUrl = targetUrl.protocol === 'https:' ? resolveUpstreamProxyUrl() : '';
  const requestOptions = {
    method,
    ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl), ecdhCurve: UPSTREAM_PROXY_TLS_ECDH_CURVE } : {}),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
    }
  };
  // Move the existing settle, cleanup, timeout and abort implementation here unchanged.
}
```

让现有 `requestUpstream` 委托到该函数并保持 POST Chat Completions 行为；新增：

```js
function requestUpstreamModels(config, onResponse, options) {
  return requestUpstreamUrl(buildModelsUrl(config.baseUrl), {
    method: 'GET', apiKey: config.apiKey, body: ''
  }, onResponse, options);
}
```

导出 `buildModelsUrl`、`requestUpstreamModels`。不得把 Key 写入错误消息或日志，不得设置 `rejectUnauthorized: false`。

- [ ] **Step 4: 运行共享层测试并确认通过**

Run: `node --test tests/upstream-proxy.test.js tests/novel-panel-stability.test.js`

Expected: 新增 Models 测试通过，现有超时/中断契约仍通过。

- [ ] **Step 5: 提交共享请求层改动**

```bash
git add lib/shared.js tests/upstream-proxy.test.js
git commit -m "feat: add independent model catalog request"
```

### Task 2: 增加文本和生图的独立 Express 测试接口

**Files:**
- Modify: `routes/chat.js:1-25,255-300`
- Create: `tests/model-connection-routes.test.js`

- [ ] **Step 1: 写失败的接口隔离测试**

```js
test('text test accepts only text fields and keeps the legacy endpoint', async () => {
  // Authenticate a test app request, post to /api/test/text and /api/test,
  // and assert both call the text upstream configuration, never body.image.
});

test('image test reads only image configuration and does not submit an image generation request', async () => {
  // Post { image: { baseUrl, apiKey, model } } to /api/test/image.
  // Stub requestUpstreamModels and assert it receives image values only,
  // returns { ok: true, kind: 'image', modelListed: true }, and does not call requestUpstream.
});

test('image test reports a reachable catalog with a missing configured model', async () => {
  // Return { data: [{ id: 'other-image-model' }] } and assert modelListed === false.
});
```

- [ ] **Step 2: 运行接口测试并确认失败**

Run: `node --test tests/model-connection-routes.test.js`

Expected: FAIL，因为 `/api/test/text`、`/api/test/image` 和可注入测试处理器尚不存在。

- [ ] **Step 3: 实现两个明确的处理器**

在 `routes/chat.js` 定义 `testTextConnection(req, res)`，复用现有 5 token Chat Completions 验证，成功返回：

```js
{ ok: true, kind: 'text', message: data.choices[0].message }
```

定义 `testImageConnection(req, res)`：

```js
const current = readConfig(req.username);
const image = { ...current.image, ...(req.body?.image || {}) };
image.apiKey = req.body?.image?.apiKey || current.image?.apiKey;
ensureReadyConfig(image);
const upstream = await requestUpstreamModels(image, collectResponse);
const catalog = JSON.parse(upstream.text);
const ids = Array.isArray(catalog.data) ? catalog.data.map(item => item?.id).filter(Boolean) : [];
const modelListed = ids.length ? ids.includes(image.model) : null;
return res.json({ ok: true, kind: 'image', modelListed, message: modelListed === false ? '生图服务已连接，但模型目录未包含当前模型。' : '生图服务连接成功。' });
```

将 `POST /api/test` 和 `POST /api/test/text` 都挂到文本处理器；将 `POST /api/test/image` 挂到图片处理器。上游非 2xx、非法 JSON、缺字段和网络异常分别返回非 2xx JSON，且仅含可公开错误信息。

- [ ] **Step 4: 运行接口回归测试**

Run: `node --test tests/model-connection-routes.test.js tests/upstream-proxy.test.js`

Expected: PASS；文本和生图请求的配置来源、URL 和 HTTP method 可独立验证。

- [ ] **Step 5: 提交独立测试接口改动**

```bash
git add routes/chat.js tests/model-connection-routes.test.js
git commit -m "feat: add separate text and image connection tests"
```

### Task 3: 设置页使用两个独立的按钮和客户端调用

**Files:**
- Modify: `frontend/src/shared/api/config.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx:35-130,185-225`
- Modify: `tests/account-image-settings-ui-contract.test.js`

- [ ] **Step 1: 写失败的前端契约测试**

```js
test('settings use isolated text and image connection-test actions', () => {
  const source = read('frontend/src/user/pages/SettingsPage.jsx');
  assert.match(source, /testingText/);
  assert.match(source, /testingImage/);
  assert.match(source, /测试文本连接/);
  assert.match(source, /测试生图连接/);
  assert.match(source, /testTextConfig\(/);
  assert.match(source, /testImageConfig\(\{ image:/);
  assert.doesNotMatch(source, /onClick=\{handleTest\}/);
});

test('configuration client exposes separate test endpoints', () => {
  const source = read('frontend/src/shared/api/config.js');
  assert.match(source, /apiRequest\('\/api\/test\/text'/);
  assert.match(source, /apiRequest\('\/api\/test\/image'/);
});
```

- [ ] **Step 2: 运行前端契约测试并确认失败**

Run: `node --test tests/account-image-settings-ui-contract.test.js`

Expected: FAIL，因为当前仅有 `handleTest` 和 `/api/test`。

- [ ] **Step 3: 实现独立客户端与交互状态**

在 `frontend/src/shared/api/config.js` 增加：

```js
export function testTextConfig(config) {
  return apiRequest('/api/test/text', { method: 'POST', body: JSON.stringify(config) });
}

export function testImageConfig(image) {
  return apiRequest('/api/test/image', { method: 'POST', body: JSON.stringify({ image }) });
}
```

在 `SettingsPage.jsx`：
- 用 `testingText` 与 `testingImage` 替换单一 `testing`；
- `handleTextTest` 验证 `provider`、`baseUrl`、`model`，仅传文本 `apiKey`；
- `handleImageTest` 验证 `image.baseUrl`、`image.model`，仅传 `image` 字段及暂存的 `image.apiKey`；
- 文本区显示“测试文本连接”，生图区显示“测试生图连接”；每个按钮只绑定自己的 loading 状态；
- 删除旧的通用“测试连接”按钮；保存逻辑保持不变。

- [ ] **Step 4: 构建并验证前端契约**

Run: `node --test tests/account-image-settings-ui-contract.test.js && npm --prefix frontend run build`

Expected: PASS；Vite 生产构建完成。

- [ ] **Step 5: 提交前端独立测试交互**

```bash
git add frontend/src/shared/api/config.js frontend/src/user/pages/SettingsPage.jsx tests/account-image-settings-ui-contract.test.js
git commit -m "feat: separate text and image test controls"
```

### Task 4: 端到端验证，不消耗生图额度

**Files:**
- Modify only files from Tasks 1-3 when验证发现与测试契约不一致。

- [ ] **Step 1: 运行针对性 Node 测试与静态检查**

Run:

```bash
node --test tests/upstream-proxy.test.js tests/model-connection-routes.test.js tests/account-image-settings-ui-contract.test.js
node -c lib/shared.js
git diff --check
```

Expected: 所有新增与受影响测试通过，且无 diff 空白错误。

- [ ] **Step 2: 重启 Express LaunchAgent 并验证页面**

Run:

```bash
launchctl kickstart -k "gui/$(id -u)/com.ming.qiantie"
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/settings
```

Expected: 页面返回 `200`，LaunchAgent 保持 `QIANTIE_HTTPS_PROXY=http://127.0.0.1:7893`。

- [ ] **Step 3: 使用无效临时 Key 验证 TLS 路径**

对 `/api/test/text` 和 `/api/test/image` 发送无效 Key；预期接收上游鉴权错误而非 `EPROTO`。不点击或调用任何图片生成接口。

- [ ] **Step 4: 浏览器检查设置页**

确认文本区和生图区各有一个按钮；点击其中一个时另一个不进入 loading；两者错误信息不显示 Key。仅在用户明确同意的情况下才做真实文本或图片模型调用。
