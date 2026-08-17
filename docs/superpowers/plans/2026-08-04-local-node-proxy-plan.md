# Local Node Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Novel2Script 增加本地 Node.js 代理后端，让浏览器不再直连第三方 AI API，解决 CORS 和 API Key 暴露问题。

**Architecture:** 前端 `index.html` 保持工作台 UI，AI 请求改为调用本地 Node 服务。Node 服务负责配置保存、连接测试、OpenAI 兼容 Chat Completions 转发，并支持流式与非流式响应。

**Tech Stack:** Node.js 原生 `http`/`fs`/`path`，前端 Vanilla JS，配置文件 `api-config.json`。

## Global Constraints

- 保持当前 `index.html` 单页应用，不引入前端框架。
- 新增本地 `server.js`，不引入 Express，避免依赖复杂化。
- API Key 不再长期保存到浏览器 localStorage。
- 后端配置保存到 `api-config.json`，该文件只在本地使用。
- 支持 OpenAI 兼容接口：`POST /v1/chat/completions`。
- Base URL 兼容域名、`/v1` 根地址、完整 `/chat/completions` 地址。
- 保留现有人物/场景提取、剧本生成、流式输出、重新生成能力。

---

## 文件结构

```text
f:\脚本测试\qiantie\
├── index.html          # 修改：前端 API 调用改成本地后端
├── server.js           # 新增：本地 Node 代理服务
├── package.json        # 新增：启动脚本
└── api-config.json     # 运行时生成：保存 API 配置
```

---

### Task 1: 创建本地 Node 代理服务

**Files:**
- Create: `f:\脚本测试\qiantie\server.js`
- Create: `f:\脚本测试\qiantie\package.json`

**Interfaces:**
- Produces: HTTP 服务，监听 `http://localhost:3000`
- Produces endpoints:
  - `GET /` 返回 `index.html`
  - `GET /api/config` 返回脱敏配置
  - `POST /api/config` 保存配置
  - `POST /api/test` 测试连接
  - `POST /api/chat` 转发 Chat Completions

- [ ] **Step 1: 创建 `package.json`**

内容：

```json
{
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {}
}
```

- [ ] **Step 2: 创建 `server.js` 基础 HTTP 服务**

实现：
- 静态返回 `index.html`
- 统一 CORS header
- JSON body 读取函数
- 404 返回 JSON

- [ ] **Step 3: 实现配置读写**

实现函数：

```js
function readConfig()
function writeConfig(config)
function publicConfig(config)
```

要求：
- `api-config.json` 不存在时返回默认配置
- `GET /api/config` 不返回 `apiKey` 明文，只返回 `hasApiKey`
- `POST /api/config` 保存 `provider/baseUrl/model/apiKey`

- [ ] **Step 4: 实现 URL 拼接**

实现函数：

```js
function buildChatCompletionsUrl(baseUrl)
```

规则：
- `https://host` → `https://host/v1/chat/completions`
- `https://host/v1` → `https://host/v1/chat/completions`
- `https://host/v1/chat/completions` → 原样

- [ ] **Step 5: 实现 `/api/test`**

后端读取配置，向真实 API 发送：

```json
{
  "model": "配置中的模型名",
  "messages": [{ "role": "user", "content": "Hi" }],
  "max_tokens": 5
}
```

成功条件：返回 JSON 且包含 `choices[0].message`。

- [ ] **Step 6: 实现 `/api/chat` 非流式转发**

当请求体 `stream !== true`：
- 后端补上 `model`
- 带上 `Authorization: Bearer <apiKey>`
- 返回真实 API 的 JSON 文本

- [ ] **Step 7: 实现 `/api/chat` 流式转发**

当请求体 `stream === true`：
- 后端请求真实 API 的 stream
- 响应前端 `Content-Type: text/event-stream`
- 将上游 chunk 原样转发给前端

- [ ] **Step 8: 验证语法**

Run:

```powershell
node --check server.js
```

Expected: exit code 0。

---

### Task 2: 前端 API 配置改为调用本地后端

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html`

**Interfaces:**
- Consumes: 后端 `GET /api/config`、`POST /api/config`、`POST /api/test`
- Produces: 设置面板不再依赖 localStorage 保存 API Key

- [ ] **Step 1: 修改 `ApiConfig.get()`**

让页面打开设置时从 `/api/config` 获取当前配置。

- [ ] **Step 2: 修改保存逻辑**

点击保存时调用：

```js
fetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) })
```

- [ ] **Step 3: 修改测试连接**

点击测试时先保存临时配置到 `/api/config`，再调用 `/api/test`。

- [ ] **Step 4: 保留 UI 字段**

设置弹窗仍保留：
- API 提供商
- API Key
- Base URL
- 模型名称

当后端已有 key 时，API Key 输入框 placeholder 显示“已保存，留空则不修改”。

---

### Task 3: 前端 AIClient 改为请求 `/api/chat`

**Files:**
- Modify: `f:\脚本测试\qiantie\index.html`

**Interfaces:**
- Consumes: `POST /api/chat`
- Produces: 原有 `AIClient.call(messages, options)` 与 `AIClient.callStream(messages, onChunk, options)` 对外接口不变

- [ ] **Step 1: 修改非流式调用**

`AIClient.call()` 不再读取 API Key/Base URL/Model，只发送：

```js
{
  "messages": messages,
  "max_tokens": options.maxTokens || 4096,
  "temperature": options.temperature ?? 0.7,
  "stream": false
}
```

- [ ] **Step 2: 修改流式调用**

`AIClient.callStream()` 请求 `/api/chat`，body 中 `stream: true`。

- [ ] **Step 3: 保持 SSE 解析逻辑**

前端继续解析 OpenAI SSE：

```text
data: {...}
data: [DONE]
```

- [ ] **Step 4: 删除旧前端直连逻辑**

移除前端中对第三方 Base URL 的请求拼接和 Authorization Header 逻辑。

---

### Task 4: 验证本地服务完整流程

**Files:**
- Modify if needed: `f:\脚本测试\qiantie\index.html`
- Modify if needed: `f:\脚本测试\qiantie\server.js`

**Interfaces:**
- Validates: 页面从 `http://localhost:3000` 打开并通过后端生成

- [ ] **Step 1: 启动服务**

Run:

```powershell
npm start
```

Expected:

```text
Novel2Script server running at http://localhost:3000
```

- [ ] **Step 2: 打开页面**

访问：

```text
http://localhost:3000
```

- [ ] **Step 3: 保存 API 设置**

使用：

```text
Base URL: https://ai.qqdao.com/v1
Model: 用户实际模型名
API Key: 用户实际 Key
```

- [ ] **Step 4: 测试连接**

Expected:
- 成功时显示连接成功
- 失败时显示后端返回的明确错误，不再出现 `Failed to fetch`

- [ ] **Step 5: 一键生成**

Expected:
- 第一步提取人物/场景
- 第二步流式输出剧本
- 如上游繁忙，显示 HTTP 状态与 JSON 错误

---

## Self-Review

- Spec coverage: 覆盖后端代理、配置保存、测试连接、流式/非流式转发、前端改造。
- Placeholder scan: 无 TBD/TODO/implement later。
- Type consistency: 前端保持 `AIClient.call` / `AIClient.callStream` 接口不变，后端统一 `/api/chat`。
