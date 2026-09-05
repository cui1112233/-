# Batch Factory V11 真实生产入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task with review checkpoints.

**Goal:** 让 `/batch-factory` 通过真实 Novel Fetch Intake 创建并读取持久化 V11 批次；演示页不参与验收。

**Architecture:** 保留 V11 Go/存储/API 作为唯一真实批量工厂链路；修复 Novel Fetch iframe 到外层 React 路由的同源消息桥；修复空状态入口；构建时验证静态 bundle 使用 V11 endpoint。

**UI Baseline:** 真实 `/batch-factory` 保持用户提供截图的深色三列工作台和批次状态/小说/预览/批量工具分区，但所有标题、数量、状态和媒体都来自 V11 服务端，不复制截图示例数据。

**Tech Stack:** React/Vite、Ant Design、浏览器 postMessage、Node 内置测试、Go V11 API、现有 Docker/公网发布流程。

## Global Constraints

- 所有修改只写 `/Users/ming/Downloads/qiantie/.worktrees/v88-mainline` 的 `v88` 分支。
- 不修改当前工作树的用户改动，不执行 reset、checkout 或 `down -v`。
- 不使用 preview/mock 数据证明生产可用。
- 每个功能先写失败测试，确认失败后再实现。
- 未完成构建、后端、浏览器和持久化验收前，不发布公网、不切主分支。

---

### Task 1: 固化真实生产入口与消息桥契约

**Files:**
- Create: `frontend/src/user/pages/novel-fetch-production-bridge.test.js`
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx`

**Step 1: Write the failing tests**

覆盖三条契约：外层页面只接受同源 `qiantie:batch-factory-intake` 消息并导航；V11 空状态提供 `/novel-fetch` 真实入口；空状态不引用 preview/mock 历史数据。

**Step 2: Run tests to verify they fail**

Run: `node --test frontend/src/user/pages/novel-fetch-production-bridge.test.js`

Expected: FAIL，因为当前 NovelFetchPage 未注册消息监听，BatchFactoryV11UiPage 的无 Intake 状态只有刷新按钮。

**Step 3: Implement the smallest production change**

- 抽出可测试的同源消息判断/redirect helper。
- 在 `NovelFetchPage` 生命周期中注册并清理 `message` listener，调用现有路由导航方式。
- 在 V11 无批次且无 Intake 时增加“去小说获取并导入”按钮，指向 `/novel-fetch`。

**Step 4: Run tests to verify they pass**

Run: `node --test frontend/src/user/pages/novel-fetch-production-bridge.test.js`

Expected: PASS。

### Task 2: 固化 V11 转入与静态产物不会回退旧接口

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-v11/novel-fetch-intake-source.test.js`
- Modify: `frontend/public/batch-rewrite/app.js` only if the source contract is incomplete

**Step 1: Add regression assertions**

断言转入 payload 保留 `sourceTaskId`、`bookId`、`sourceText`、`txtText`、`txtFileName`、`sourceMetadata`，并断言不出现旧 `/api/batch-factory/intakes/novel-fetch`。

**Step 2: Run the focused test**

Run: `node --test frontend/src/user/pages/batch-factory-v11/novel-fetch-intake-source.test.js`

Expected: PASS on source, ensuring regression coverage remains explicit。

**Step 3: Build and inspect output**

Run: `npm run frontend:build`

Then assert the generated `frontend/dist/batch-rewrite/app.js` contains V11 endpoint and no legacy endpoint.

### Task 3: Verify real backend create/read/persistence boundary

**Files:**
- Inspect and modify only if a failing test identifies a V11 bug: `backend/internal/batchfactoryv11/*`, `backend/internal/httpapi/*`

**Step 1: Run existing focused backend tests**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi`

Expected: PASS, including Intake ownership, lineage preservation, one-time consumption and route registration。

**Step 2: If a test fails, add the smallest regression test first**

Do not loosen auth or bypass V11 storage. Preserve the existing owner scope and error status semantics.

**Step 3: Re-run focused Go tests and frontend tests**

Expected: all focused tests PASS。

### Task 4: Candidate build and authenticated browser smoke

**Files:**
- No source changes unless a smoke failure maps to a tested defect.

**Step 1: Build the v88 candidate**

Run the repository's isolated v88 review compose/build command after checking its env and volume names. Do not touch public containers or formal volumes.

**Step 2: Browser smoke with an authenticated account**

1. Open `/batch-factory`; verify V11 page and real empty-state entry.
2. Open `/novel-fetch`, select a real completed task with original text, click “进入批量工厂”。
3. Verify URL includes `intake`, Intake summary is visible, and click “创建 V11 批次”。
4. Verify real batch/book data, refresh, and confirm it remains available.

**Step 3: Record evidence boundaries**

Capture served build identity, bundle hash/provenance, API status, browser URL, and persistence result. Do not call preview data production evidence.

### Task 5: Public promotion only after all gates

**Files:**
- No additional code changes.

**Step 1: Re-check v88 git status, commit SHA, build artifact and rollback reference**

Do not include unrelated worktree changes。

**Step 2: Deploy only the verified candidate using the existing volume-preserving public procedure**

Do not rebuild uncached on ECS, delete old images, or remove formal data volumes。

**Step 3: Re-run authenticated public smoke**

Use the exact real flow from Task 4. If any gate fails, stop at candidate/public rollback and report the precise boundary; do not claim the feature is usable。
