# 小说面板稳定化修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 V77 小说面板补齐 Express 接口、可取消模型请求和账号隔离草稿。

**Architecture:** 保留 React 壳、sandbox iframe、V77 工作台和现有项目 JSON。新增小说面板运行时模块负责租约、同功能去重和草稿；扩展共享上游客户端支持显式超时和取消。

**Tech Stack:** Node.js、Express、node:test、原子 JSON 存储、React iframe bridge、原生 http/https。

---

## 文件结构

- Create: `lib/novel-panel/runtime.js`：租约、操作登记和账号草稿。
- Modify: `lib/shared.js`：上游超时与取消。
- Modify: `routes/novel-panel.js`：CharacterCore、草稿和请求控制路由。
- Modify: `public/novel-panel/workbench/app.js`：后端草稿。
- Modify: `public/novel-panel/workbench/character-core/character-core.js`：409 不重试。
- Modify: `public/novel-panel/workbench/bridge.js` 与 `frontend/src/user/pages/NovelPanelPage.jsx`：取消传递。
- Create: `tests/novel-panel-runtime.test.js` 与 `tests/novel-panel-stability.test.js`。
- Modify: `tests/novel-panel-asset-contract.test.js`：接口、草稿和桥接契约。

### Task 1: 运行时模块

**Files:** Create `lib/novel-panel/runtime.js`; Create `tests/novel-panel-runtime.test.js`.

- [ ] **Step 1: 写失败测试**

`runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_a' })` 必须返回 `acquired: true`；同账号同项目的 `tab_b` 返回 `acquired: false`；不同账号可以取得同 ID 项目租约。`runtime.saveDraft('alice', { projectName: '草稿', data: { novel_text: '甲' } })` 后只有 alice 可读；带原型污染键或大于 5 MB 的草稿抛出 `Invalid novel-panel draft`。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-runtime.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小模块**

导出 `createNovelPanelRuntime({ usersDir, now = () => Date.now(), leaseTtlMs = 90000 })`。`lease()` 支持 `acquire`、`heartbeat`、`release`，仅持有者可续租或释放，过期自动删除；`beginOperation(username, operation)` 返回一次性 release 函数或 null；`saveDraft/loadDraft` 通过 `writeJsonAtomic/readJsonOrMissing` 写入 `<usersDir>/<username>/novel-panel/draft.json`，仅接受 JSON 安全的 plain object 并深拷贝。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/novel-panel-runtime.test.js`

Expected: PASS。

Commit: `git add lib/novel-panel/runtime.js tests/novel-panel-runtime.test.js && git commit -m "feat: add novel panel runtime safeguards"`

### Task 2: 上游请求超时与取消

**Files:** Modify `lib/shared.js:200-221`; Create `tests/novel-panel-stability.test.js`.

- [ ] **Step 1: 写失败测试**

在本地慢速 Chat Completions 模拟服务上调用 `requestUpstream(config, payload, collectResponse, { timeoutMs: 20 })`，断言拒绝消息为 `Upstream request timed out`，并断言模拟服务看到连接中止。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="slow upstream"`

Expected: FAIL，现有函数没有 options。

- [ ] **Step 3: 实现请求生命周期**

把签名扩展为 `requestUpstream(config, payload, onResponse, { timeoutMs = 0, signal } = {})`。用 `setTimeout` 和 `signal.addEventListener('abort', ..., { once: true })` 调 `upstreamReq.destroy(error)`；所有 `error`、`end`、`close` 路径只能结算一次并清理计时器和 listener。默认零超时，避免改坏 chat/agent 调用。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="slow upstream"`

Expected: PASS。

Commit: `git add lib/shared.js tests/novel-panel-stability.test.js && git commit -m "fix: bound novel panel upstream requests"`

### Task 3: CharacterCore 与草稿 HTTP 契约

**Files:** Modify `routes/novel-panel.js`; Modify `tests/novel-panel-stability.test.js`.

- [ ] **Step 1: 写失败测试**

登录后请求 `POST /api/novel-panel/character-core/parse-slots`，输入 `林晚（成年）、顾沉`，断言 200 与 `slot_count: 2`。分别请求 `project-lease` acquire、`migrate-project`、`PUT /draft` 与 `GET /draft`，断言均需 Bearer 认证、账号隔离且返回可用 JSON。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="CharacterCore slots"`

Expected: FAIL，当前接口 404。

- [ ] **Step 3: 实现接口**

添加 `parseForcedRoster()`：仅以换行、逗号、顿号、分号、竖线拆分名单，保留括号内年龄阶段，生成稳定 `slot_id`、`slot_token`、`source_entry`、`display_name`、`base_name`、`aliases`、`age`、空生成字段；不得请求模型或从小说正文推断新人物。添加 `POST /character-core/parse-slots`、`POST /character-core/project-lease`、`POST /character-core/migrate-project`、`GET /draft`、`PUT /draft`。迁移优先规范化现有 v2 数据，否则只由旧 `project.data.characters` 产生兼容槽位，绝不自动覆盖项目。

- [ ] **Step 4: 接入服务端超时和浏览器关闭取消**

`requestCompletion()` 读取 `loadPanelSettings(username).ai_timeout_seconds` 并传递 `{ timeoutMs, signal }`；AI 路由在 `req.aborted` 或响应未完成时 `res.close` 调 `AbortController.abort()`。上游超时返回 HTTP 504 和“服务端已停止本次模型请求”。

- [ ] **Step 5: 验证并提交**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="CharacterCore slots"`

Expected: PASS。

Commit: `git add routes/novel-panel.js tests/novel-panel-stability.test.js && git commit -m "feat: complete novel panel CharacterCore routes"`

### Task 4: 同功能 AI 请求去重

**Files:** Modify `lib/novel-panel/runtime.js`; Modify `routes/novel-panel.js`; Modify `public/novel-panel/workbench/character-core/character-core.js`; Modify `tests/novel-panel-stability.test.js`.

- [ ] **Step 1: 写失败测试**

让第一个 `/api/novel-panel/analyze` 停在受控上游响应；在完成前提交第二个相同账号分析请求，断言 HTTP 409、`code: NOVEL_PANEL_OPERATION_IN_PROGRESS`；释放第一个响应后断言第一个 200 且第三个请求可再次执行。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="second request"`

Expected: FAIL，当前允许重叠。

- [ ] **Step 3: 实现并接入操作登记**

在路由使用 `runAiOperation(req, res, operation, execute)`：`runtime.beginOperation()` 返回 null 时回 409，否则 try/finally release。操作键为 `analyze`、`character:<slot>`、`outline`、`scene:<id>`、`style`、`instruction`、`character-core:<stage>:<slot>`。包裹分析、人物、整段/单镜分镜、风格、指令与 CharacterCore 分析。前端 `retryableAiError()` 遇到 `NOVEL_PANEL_OPERATION_IN_PROGRESS|HTTP 409|正在处理中` 返回 false，不清空结果。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/novel-panel-stability.test.js --test-name-pattern="second request"`

Expected: PASS。

Commit: `git add lib/novel-panel/runtime.js routes/novel-panel.js public/novel-panel/workbench/character-core/character-core.js tests/novel-panel-stability.test.js && git commit -m "fix: prevent overlapping novel panel AI operations"`

### Task 5: iframe 草稿后端化

**Files:** Modify `public/novel-panel/workbench/app.js:8960-9015,12131-12400`; Modify `tests/novel-panel-asset-contract.test.js`.

- [ ] **Step 1: 写失败契约测试**

断言 `app.js` 包含 `requestJSON('/api/draft'`；`extractFunctionBody(app, 'restoreLocalDraft')` 与 `extractFunctionBody(app, 'scheduleDraftSave')` 都不包含 `localStorage`。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-asset-contract.test.js --test-name-pattern="account draft API"`

Expected: FAIL，当前访问 sandbox localStorage。

- [ ] **Step 3: 实现节流草稿 API**

保留 420ms 节流：序列化 `{ projectId, projectName, data: getProjectData() }` 后，如与 `lastDraftSerialized` 不同则 `PUT /api/draft`；`restoreLocalDraft()` 改为 `GET /api/draft` 后 `applyProjectData()`。恢复失败仅 console warning，再进入现有空状态；手动保存项目仍只走 `/api/projects`。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/novel-panel-asset-contract.test.js --test-name-pattern="account draft API"`

Expected: PASS。

Commit: `git add public/novel-panel/workbench/app.js tests/novel-panel-asset-contract.test.js && git commit -m "fix: persist novel panel drafts per account"`

### Task 6: bridge 取消传递与验收

**Files:** Modify `public/novel-panel/workbench/bridge.js`; Modify `frontend/src/user/pages/NovelPanelPage.jsx`; Modify `tests/novel-panel-asset-contract.test.js`.

- [ ] **Step 1: 写失败桥接契约测试**

断言 bridge 含 `novel-panel-api-cancel`；父页面含 `AbortController` 和 `controller.abort`。

- [ ] **Step 2: 确认失败**

Run: `node --test tests/novel-panel-asset-contract.test.js --test-name-pattern="forwards cancellation"`

Expected: FAIL，当前 iframe 超时只拒绝自身 Promise。

- [ ] **Step 3: 实现取消传递**

bridge 超时、关闭或页面隐藏时给 parent 发 `{ type: 'novel-panel-api-cancel', id }`。父页维护 request id 到 `AbortController` 的 Map，parent fetch 用该 signal；收到取消、端口关闭和 iframe 重载时 abort 并删除所有匹配控制器。不改变 sandbox 配置。

- [ ] **Step 4: 全量验证并提交**

Run: `node --test tests/novel-panel-asset-contract.test.js tests/novel-panel-project-store.test.js tests/novel-panel-quality-gate.test.js tests/novel-panel-runtime.test.js tests/novel-panel-stability.test.js && git diff --check`

Expected: 全部 PASS，diff 无错误。

浏览器验证：打开 `/novel-panel`，无 localStorage sandbox 警告；强制名单 `parse-slots` 为 200；双标签同项目提示租约冲突；低超时请求提示服务端已停止。

Commit: `git add public/novel-panel/workbench/bridge.js frontend/src/user/pages/NovelPanelPage.jsx tests/novel-panel-asset-contract.test.js && git commit -m "fix: cancel stale novel panel bridge requests"`
