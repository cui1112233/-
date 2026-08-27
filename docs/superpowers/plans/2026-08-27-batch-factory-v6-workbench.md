# 批量工厂 V6 工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/batch-factory` 实现为 V6 四区工作台，并在不替换现有 API 的前提下接入真实批次、生产、合并和状态流程。

**Architecture:** 以 `BatchFactoryPreviewPage.jsx` 作为唯一正式工作台视图，将现有 API 调用集中在页面状态层，使用独立的状态归一化、布局持久化和 Prompt 编译边界。`BatchFactoryPage.jsx` 仅保留路由兼容壳，`/batch-factory-preview` 继续用于开发验收。

**Tech Stack:** React 18, Ant Design, lucide-react, Vite, Express, Node test runner, Docker Compose。

## Global Constraints

- 正式用户入口只有 `/batch-factory`，不得加入全局导航。
- V6 四区默认布局：小说列表、当前小说、视频操作/统一播放器、全批次进度。
- 状态中心点击只更新右侧当前筛选，并使用连续定位，不过滤左侧列表。
- 所有 VIDEO 和最终合并结果共用一个播放器。
- 系统 Prompt 只在管理后台维护，生产页不显示 Prompt Studio 或系统正文。
- `visualPrompt`、`compiledPrompt`、`productionSnapshot` 必须分离。
- 设置优先级为 `system < batch < book < video`，正常模式锁定布局，编辑模式才允许调整并保存。
- 保留无关工作树改动，不提交凭据、真实环境文件或用户数据。

### Task 1: Lock the V6 workbench shell

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`
- Test: `tests/batch-factory-workbench-ui.test.js`

**Interfaces:**
- Consumes: existing `BatchFactoryPreviewPage` API imports and `BatchFactoryPage` route mount.
- Produces: stable `batch-factory-workbench-grid` with four named regions, V6 header, collapsed navigation, and no static sample fallback.

- [ ] **Step 1: Add failing shell assertions** for four regions, title/return action, no global navigation entry, and no sample rows.
- [ ] **Step 2: Run** `node --test tests/batch-factory-workbench-ui.test.js` and confirm the new assertions fail against the current shell.
- [ ] **Step 3: Implement** the V6 shell in `BatchFactoryPreviewPage.jsx`; keep `BatchFactoryPage` as a thin renderer and preserve `/shuihuo-production` return behavior.
- [ ] **Step 4: Add responsive CSS** with default V6 column proportions, collapsed sections, light/dark theme tokens, and explicit layout-editing class.
- [ ] **Step 5: Run** the focused UI contract test and commit `feat: establish v6 batch factory workbench shell`.

### Task 2: Wire batch data, status center, and continuous locator

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`
- Test: `tests/batch-factory-status-locator.test.js`

**Interfaces:**
- Consumes: `listBatchFactoryBatches`, `getBatchFactoryBatch`, `resolveBookStatus`, and item activity data.
- Produces: `currentFilter`, `locateStatus(label)`, stable full novel list, status counts, and repeat-click cursor behavior.

- [ ] **Step 1: Write failing tests** asserting status counts, no list filtering, and repeated `locateStatus('异常')` advances through matching item IDs and wraps.
- [ ] **Step 2: Run** `node --test tests/batch-factory-status-locator.test.js` and verify failure.
- [ ] **Step 3: Implement** a pure locator helper and connect it to status-center buttons; call `scrollIntoView` on the matching novel row while keeping all rows rendered.
- [ ] **Step 4: Map project/video states** into V6 labels and preserve red failure priority over purple manual-edit markers.
- [ ] **Step 5: Run** both focused tests and commit `feat: add batch factory status center locator`.

### Task 3: Add V6 production controls and single-player surface

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`
- Test: `tests/batch-factory-player-controls.test.js`

**Interfaces:**
- Consumes: `updateBatchFactorySettings`, `updateBatchFactoryItem`, `generateBatchFactoryBatch`, merge capability and video project status APIs.
- Produces: production/publish tabs, batch and single-book actions, one player target selector, and aggregate progress ring.

- [ ] **Step 1: Write failing tests** for production/publish tabs, one player element, final-merge/VIDEO selector, aggregate progress, and persisted batch/book settings.
- [ ] **Step 2: Run** `node --test tests/batch-factory-player-controls.test.js` and verify failure.
- [ ] **Step 3: Implement** the right rail and player target state; route all preview selections through the same player element.
- [ ] **Step 4: Connect** batch and book actions to existing APIs, refresh state after success, and preserve per-item errors after partial failures.
- [ ] **Step 5: Run** focused tests and commit `feat: connect v6 production and player controls`.

### Task 4: Enforce Prompt compiler and VIDEO override boundaries

**Files:**
- Modify: `lib/batch-factory/video-prompt-compiler.js`
- Modify: `routes/batch-factory-production.js`
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Create: `tests/batch-factory-prompt-boundary.test.js`

**Interfaces:**
- Consumes: director storyboard, batch settings, book/item overrides, asset references, and provider capability data.
- Produces: `visualPrompt` editing, `compiledPrompt` preview, `productionSnapshot`, and system/batch/book/video precedence.

- [ ] **Step 1: Write failing tests** proving visualPrompt excludes injected prefix/assets, compiledPrompt includes enabled sections in V6 order, and a video override wins over batch settings.
- [ ] **Step 2: Run** `node --test tests/batch-factory-prompt-boundary.test.js` and verify failure.
- [ ] **Step 3: Implement** pure section compilation with explicit source metadata and preserve provider-specific negative prompt mapping at submission time.
- [ ] **Step 4: Persist** the compiled snapshot with the production result without overwriting editable visualPrompt.
- [ ] **Step 5: Add** single VIDEO Drawer states (`follow`, `on`, `off`, `custom`) and asset reference selection, then run focused tests and commit `feat: enforce v6 prompt boundaries`.

### Task 5: Layout editing, persistence, and full verification

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`
- Test: `tests/batch-factory-layout-persistence.test.js`
- Test: `tests/batch-factory-current-mainline-contract.test.js`

**Interfaces:**
- Consumes: V6 shell and state surfaces from Tasks 1-4.
- Produces: edit-layout mode, column resize/collapse persistence, default restore, and release-ready verification.

- [ ] **Step 1: Write failing tests** for default proportions, edit-only resizing, malformed preference fallback, and restore-default behavior.
- [ ] **Step 2: Run** the focused layout tests and verify failure.
- [ ] **Step 3: Implement** validated local-storage persistence keyed by user, with grid constraints and normal-mode locking.
- [ ] **Step 4: Run** all batch factory contracts, `npm --prefix frontend run build`, and `git diff --check`.
- [ ] **Step 5: Build and recreate** only the production platform container using the deployment compose file; verify `/batch-factory` returns `200`.
- [ ] **Step 6: Commit** `feat: complete v6 batch factory workbench` after tests and Docker health checks pass.

