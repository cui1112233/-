# Express 多页面架构收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `qiantie` 收口为 Express 多页面应用：`/` 只做首页，`/script`、`/agent`、`/tts` 作为独立页面，并同步技术文档和验证脚本。

**Architecture:** 保留现有 Express 路由模块结构，不回退手写 Node 路由。前端使用真实页面跳转，不再在首页中内嵌剧本页和 Agent 页。新增一个轻量 Node 验证脚本，防止首页重新混入 SPA 页面容器。

**Tech Stack:** Node.js CommonJS、Express、原生 HTML/CSS/JavaScript、Node 内置 `assert/fs/path`。

---

## File Structure

- Create: `scripts/validate-multipage-architecture.js`
  - 静态检查首页、多页面路由、脚本加载和文档关键声明。
- Modify: `index.html`
  - 只保留首页、公共 topbar、公共弹窗和历史入口。
  - 删除 `page-script`、`page-agent`、剧本生成 DOM、`public/js/script.js` 引用。
- Modify: `public/js/common.js`
  - 将导航统一为真实 URL 跳转。
  - 支持任意带 `data-href` 的点击元素，包括首页快捷卡片。
  - 移除或弱化 `data-page` 的 SPA 页面切换逻辑。
- Modify: `docs/技术文档.md`
  - 更新为 Express、多页面、Bearer 鉴权、`public/` 静态资源和 `views/` 页面结构。
- No change: `server.js`, `routes/pages.js`, `views/script.html`, `views/agent.html`, `views/tts.html`
  - 这些文件已经表达了目标方向，本轮只通过验证脚本确认它们保持可用。

---

### Task 1: Add Static Architecture Validation

**Files:**
- Create: `scripts/validate-multipage-architecture.js`
- Test: `scripts/validate-multipage-architecture.js`

- [ ] **Step 1: Create the failing validation script**

Create `scripts/validate-multipage-architecture.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertIncludes(text, needle, label) {
  assert(
    text.includes(needle),
    `${label} should include ${JSON.stringify(needle)}`
  );
}

function assertNotIncludes(text, needle, label) {
  assert(
    !text.includes(needle),
    `${label} should not include ${JSON.stringify(needle)}`
  );
}

const home = read('index.html');
const scriptPage = read('views/script.html');
const agentPage = read('views/agent.html');
const ttsPage = read('views/tts.html');
const pagesRouter = read('routes/pages.js');
const commonJs = read('public/js/common.js');
const techDoc = read('docs/技术文档.md');

assertNotIncludes(home, 'id="page-script"', 'index.html');
assertNotIncludes(home, 'id="page-agent"', 'index.html');
assertNotIncludes(home, 'id="novel-input"', 'index.html');
assertNotIncludes(home, 'src="/js/script.js"', 'index.html');

assertIncludes(home, 'data-href="/script"', 'index.html');
assertIncludes(home, 'data-href="/agent"', 'index.html');
assertIncludes(home, 'data-href="/tts"', 'index.html');

assertIncludes(scriptPage, 'id="page-script"', 'views/script.html');
assertIncludes(scriptPage, 'id="novel-input"', 'views/script.html');
assertIncludes(scriptPage, 'src="/js/script.js"', 'views/script.html');

assertIncludes(agentPage, 'id="page-agent"', 'views/agent.html');
assertNotIncludes(agentPage, 'src="/js/script.js"', 'views/agent.html');

assertIncludes(ttsPage, 'id="page-tts"', 'views/tts.html');
assertIncludes(ttsPage, 'src="/js/tts.js"', 'views/tts.html');

assertIncludes(pagesRouter, "router.get('/',", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/script'", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/agent'", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/tts'", 'routes/pages.js');

assertIncludes(commonJs, 'data-href', 'public/js/common.js');

assertIncludes(techDoc, 'Express', 'docs/技术文档.md');
assertIncludes(techDoc, 'Authorization: Bearer <token>', 'docs/技术文档.md');
assertIncludes(techDoc, 'views/', 'docs/技术文档.md');
assertIncludes(techDoc, 'public/', 'docs/技术文档.md');
assertNotIncludes(techDoc, '零第三方依赖', 'docs/技术文档.md');
assertNotIncludes(techDoc, '无 Express / Koa / Fastify', 'docs/技术文档.md');
assertNotIncludes(techDoc, 'X-Auth-Token 请求头', 'docs/技术文档.md');

console.log('Multipage architecture validation passed.');
```

- [ ] **Step 2: Run validation and confirm it fails before implementation**

Run:

```bash
node scripts/validate-multipage-architecture.js
```

Expected: FAIL mentioning `index.html should not include "id=\"page-script\""` or a related stale documentation assertion.

- [ ] **Step 3: Commit validation script**

Run:

```bash
git add scripts/validate-multipage-architecture.js
git commit -m "test: add multipage architecture validation"
```

Expected: commit succeeds and only the validation script is included.

---

### Task 2: Convert Home Page To Route-Only Navigation

**Files:**
- Modify: `index.html`
- Test: `scripts/validate-multipage-architecture.js`

- [ ] **Step 1: Remove SPA page containers from `index.html`**

In `index.html`, delete the full script and agent page blocks. The script block starts at:

```html
<!-- Page: Script -->
<div id="page-script" class="page-container">
```

and ends at the matching closing `</div>` immediately before the next page block. The agent block starts at:

```html
<!-- Page: Agent -->
<div id="page-agent" class="page-container">
```

and ends at the matching closing `</div>` for that page container.

After deletion, `index.html` must keep the home page container:

```html
<!-- Page: Home -->
<div id="page-home" class="page-container active">
</div>
```

- [ ] **Step 2: Change sidebar navigation to real links**

In `index.html`, replace the sidebar page-switching items:

```html
<li class="nav-item active" data-page="home">
```

with:

```html
<li class="nav-item active" data-href="/">
```

Replace:

```html
<li class="nav-item" data-page="script">
```

with:

```html
<li class="nav-item" data-href="/script">
```

Replace:

```html
<li class="nav-item" data-page="agent">
```

with:

```html
<li class="nav-item" data-href="/agent">
```

Keep the TTS item as:

```html
<li class="nav-item" data-href="/tts">
```

- [ ] **Step 3: Change quick-action cards to real route links**

In `index.html`, replace:

```html
<div class="quick-action-card card-write" data-action="nav" data-target="script">
```

with:

```html
<div class="quick-action-card card-write" data-href="/script">
```

Replace:

```html
<div class="quick-action-card card-agent" data-action="nav" data-target="agent">
```

with:

```html
<div class="quick-action-card card-agent" data-href="/agent">
```

Replace:

```html
<div class="quick-action-card card-tts" data-action="nav" data-href="/tts">
```

with:

```html
<div class="quick-action-card card-tts" data-href="/tts">
```

- [ ] **Step 4: Remove script-generation JavaScript from the home page**

In `index.html`, remove this script tag if present:

```html
<script src="/js/script.js"></script>
```

Keep:

```html
<script src="/js/common.js"></script>
```

- [ ] **Step 5: Run validation and confirm remaining failures are outside `index.html`**

Run:

```bash
node scripts/validate-multipage-architecture.js
```

Expected: may still FAIL on `public/js/common.js` or `docs/技术文档.md`, but must not fail on `index.html` containing `page-script`, `page-agent`, `novel-input`, or `/js/script.js`.

- [ ] **Step 6: Commit home page conversion**

Run:

```bash
git add index.html
git commit -m "refactor: make home page route-only"
```

Expected: commit includes only `index.html`.

---

### Task 3: Make Shared Navigation URL-Based

**Files:**
- Modify: `public/js/common.js`
- Test: `scripts/validate-multipage-architecture.js`

- [ ] **Step 1: Replace SPA navigation block with URL navigation**

In `public/js/common.js`, replace the current navigation module with this implementation:

```js
// ============================================================
// 模块：导航与页面路由
// ============================================================

(function() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('nav-toggle');

    if (!sidebar) return;

    // 导航收起/展开
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // 移动端汉堡菜单
    const topbar = document.getElementById('topbar');
    const mobileOverlay = document.getElementById('mobile-overlay');
    if (topbar) {
        topbar.addEventListener('click', (e) => {
            if (e.target === topbar && window.innerWidth < 768) {
                sidebar.classList.add('mobile-open');
                if (mobileOverlay) mobileOverlay.classList.add('visible');
            }
        });
    }
    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('visible');
        });
    }

    // 真实多页面跳转：任何带 data-href 的元素都可以作为入口
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-href]');
        if (!target) return;
        const href = target.dataset.href;
        if (!href) return;
        if (target.tagName === 'A') return;
        e.preventDefault();
        window.location.href = href;
    });
})();
```

This removes reliance on `data-page` and allows sidebar items and home cards to share the same behavior.

- [ ] **Step 2: Verify the old `data-page` switching logic is gone**

Run:

```bash
rg -n "data-page|page-container.active|targetPage|pageTitles" public/js/common.js
```

Expected: no matches.

- [ ] **Step 3: Run validation**

Run:

```bash
node scripts/validate-multipage-architecture.js
```

Expected: may still FAIL only on `docs/技术文档.md` until Task 4 is complete.

- [ ] **Step 4: Commit navigation change**

Run:

```bash
git add public/js/common.js
git commit -m "refactor: use route navigation in shared script"
```

Expected: commit includes only `public/js/common.js`.

---

### Task 4: Update Technical Documentation

**Files:**
- Modify: `docs/技术文档.md`
- Test: `scripts/validate-multipage-architecture.js`

- [ ] **Step 1: Replace the technology summary**

In `docs/技术文档.md`, replace the old “技术栈总览” table with:

```markdown
## 1. 技术栈总览

| 层次 | 语言/技术 | 说明 |
|------|-----------|------|
| **后端** | JavaScript (Node.js) + Express | Express 负责路由、JSON 请求体解析、静态资源和页面服务 |
| **前端** | HTML / CSS / JavaScript | 原生多页面实现，不使用前端框架 |
| **运行时** | Node.js (CommonJS) | 使用 `npm start` 启动 |
| **协议** | HTTP/1.1 + SSE | REST API + 流式生成 |
| **外部依赖** | Express | `package.json` 中声明 `express` 依赖 |
```

- [ ] **Step 2: Replace project structure section**

Replace the old directory tree with:

````markdown
## 2. 项目目录结构

```text
qiantie/
├── server.js                  # Express 应用入口
├── index.html                 # 首页
├── package.json               # npm start + Express 依赖
├── api-config.json            # 当前全局 API 配置；用户隔离待下一阶段处理
├── lib/
│   └── shared.js              # 共享配置、上游请求、历史文件工具
├── middleware/
│   └── auth.js                # Bearer token 鉴权与速率限制
├── routes/
│   ├── pages.js               # /、/script、/agent、/tts 页面路由
│   ├── auth.js                # /api/login
│   ├── config.js              # /api/config
│   ├── chat.js                # /api/test、/api/chat
│   ├── prompt.js              # /api/prompt
│   ├── history.js             # /api/history
│   └── tts.js                 # /api/tts
├── public/
│   ├── css/                   # 公共和页面样式
│   └── js/                    # common、script、tts 脚本
├── views/
│   ├── script.html            # 剧本生成页
│   ├── agent.html             # Agent 工作区
│   └── tts.html               # 配音页
├── prompts/                   # AI 提示词模板
├── outputs/                   # 当前全局生成历史；用户隔离待下一阶段处理
└── docs/                      # 设计文档与实施计划
```
````

- [ ] **Step 3: Replace backend architecture description**

In the backend section, state:

```markdown
## 3. 后端架构

### 3.1 技术特征

- 使用 Express，不使用旧版手写 `routeRequest`。
- `server.js` 只负责应用组合：创建 app、挂载中间件、挂载路由、启动服务。
- JSON 请求体限制当前为 `50mb`。
- 静态资源从 `public/` 提供。
- 页面路由由 `routes/pages.js` 提供。

### 3.2 主要路由

| 方法 | 路径 | 鉴权 | 功能 |
|------|------|------|------|
| `GET` | `/` | 无 | 首页 |
| `GET` | `/script` | 无 | 剧本生成页 |
| `GET` | `/agent` | 无 | Agent 工作区 |
| `GET` | `/tts` | 无 | 配音页 |
| `POST` | `/api/login` | 无 | 登录并返回 Bearer token |
| `GET/POST` | `/api/config` | Bearer token | 读取或保存当前全局 API 配置 |
| `POST` | `/api/test` | Bearer token | 测试上游 AI API |
| `POST` | `/api/chat` | Bearer token | 代理转发到上游 AI API |
| `GET` | `/api/prompt` | Bearer token | 读取提示词文件 |
| `GET/POST/DELETE` | `/api/history` | Bearer token | 生成历史管理 |
| `POST` | `/api/tts` | Bearer token | TTS 代理 |
```

- [ ] **Step 4: Add known limitation section**

Append this section near the end:

```markdown
## 8. 已知限制

- 当前登录只完成身份入口，用户数据隔离尚未完成。
- `api-config.json`、`outputs/index.json` 和生成文件仍是全局共享。
- `test-gen.js` 仍使用旧的 `X-Auth-Token` 方式，后续应更新为登录后使用 `Authorization: Bearer <token>`。
- TTS 依赖外部服务 `tts2.121w.com`，稳定性受该服务影响。
```

- [ ] **Step 5: Remove stale claims**

Run:

```bash
rg -n "零第三方依赖|无 Express|X-Auth-Token 请求头|routeRequest|单文件 SPA" docs/技术文档.md
```

Expected: no matches.

- [ ] **Step 6: Run validation**

Run:

```bash
node scripts/validate-multipage-architecture.js
```

Expected: PASS with `Multipage architecture validation passed.`

- [ ] **Step 7: Commit documentation update**

Run:

```bash
git add docs/技术文档.md
git commit -m "docs: update architecture documentation for Express multipage"
```

Expected: commit includes only `docs/技术文档.md`.

---

### Task 5: Final Runtime Verification

**Files:**
- No source edits expected.
- Test: server startup and route checks.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node -c server.js
node -c public/js/common.js
node -c public/js/script.js
node -c public/js/tts.js
```

Expected: all commands exit with code 0 and print no syntax errors.

- [ ] **Step 2: Start the server**

Run:

```bash
npm start
```

Expected: output includes:

```text
Server running on (Express):
本机访问: http://127.0.0.1:3000
```

- [ ] **Step 3: Check page routes in another terminal**

Run:

```bash
curl -s -o /tmp/qiantie-home.html -w '%{http_code}\n' http://127.0.0.1:3000/
curl -s -o /tmp/qiantie-script.html -w '%{http_code}\n' http://127.0.0.1:3000/script
curl -s -o /tmp/qiantie-agent.html -w '%{http_code}\n' http://127.0.0.1:3000/agent
curl -s -o /tmp/qiantie-tts.html -w '%{http_code}\n' http://127.0.0.1:3000/tts
```

Expected:

```text
200
200
200
200
```

- [ ] **Step 4: Check API auth boundary**

Run:

```bash
curl -s -o /tmp/qiantie-config.json -w '%{http_code}\n' http://127.0.0.1:3000/api/config
```

Expected:

```text
401
```

- [ ] **Step 5: Stop the server**

Press `Ctrl-C` in the terminal running `npm start`.

Expected: server process exits.

- [ ] **Step 6: Run static architecture validation**

Run:

```bash
node scripts/validate-multipage-architecture.js
```

Expected:

```text
Multipage architecture validation passed.
```

- [ ] **Step 7: Review git status**

Run:

```bash
git status --short
```

Expected: only known pre-existing dirty files remain, or no output if the implementation branch is clean. Do not stage unrelated debug files such as `.auth-token`, `debug-tts.bin`, or `trae-debug-log-api-502-error.ndjson`.

---

## Self-Review

- Spec coverage: Tasks 2 and 3 cover Express-served multipage navigation and home de-SPA work. Task 4 covers documentation. Task 1 and Task 5 cover verification and guardrails. User-data isolation is recorded as known limitation, not implemented, matching the spec.
- Placeholder scan: no placeholder markers or vague implementation-only steps are present.
- Consistency check: file paths match the current project layout under `/Users/ming/Downloads/qiantie`; validation assertions match the acceptance criteria in the spec.
