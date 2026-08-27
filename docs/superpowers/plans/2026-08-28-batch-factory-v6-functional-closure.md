# 批量工厂 V6 功能闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V6 生产统一设置、发布统一设置和批量生产链路落成可真实保存、执行、验证的功能。

**Architecture:** React 页面负责 V6 Drawer、设置卡和状态反馈；现有 batch-factory API 负责批次设置持久化与生产链路；发布设置存入批次 `settings.publishSettings`，121 发布在无真实回执前保持未接入。所有提示词按 `visualPrompt` 与提交时 `compiledPrompt` 分离。

**Tech Stack:** React, Ant Design, Node.js tests, Express routes, Docker Compose production publisher.

## Global Constraints

- `sourceTaskId`、`bookId`、标题、平台、TXT 和元数据从小说获取交接，不重复抓取。
- TXT 固定命名为 `{bookId}.txt`；不同小说不得串数据。
- 系统提示词正文只在管理后台系统预设词管理，主生产页只显示名称。
- 设置继承顺序为 `system < batch < book < video`。
- 状态中心结果显示在右侧当前筛选；全工作台只有一个播放器。
- TTS 只测时，不混入最终视频。
- 未验证的 121 接口不得显示成功或伪造任务 ID。

---

### Task 1: Lock Settings Data Contract

**Files:**
- Modify: `routes/batch-factory.js`
- Modify: `lib/batch-factory/store.js`
- Test: `tests/batch-factory-settings-contract.test.js`

**Interfaces:**
- `updateBatchSettings(username, batchId, settings)` preserves unknown nested `publishSettings` while validating production model and duration fields.
- Batch settings expose `publishSettings` without leaking provider credentials.

- [ ] **Step 1: Write failing tests** for nested publish settings persistence, production field validation, and book/video override precedence.
- [ ] **Step 2: Run `node --test tests/batch-factory-settings-contract.test.js` and verify the new assertions fail for the missing contract.
- [ ] **Step 3: Implement minimal store/route normalization and merge behavior.**
- [ ] **Step 4: Re-run the focused test and the existing `test/batch-factory.test.js`.
- [ ] **Step 5: Commit `feat: formalize batch factory settings contract`**.

### Task 2: Implement V6 Production Drawer

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`
- Test: `tests/batch-factory-settings-drawers.test.js`

**Interfaces:**
- `ProductionSettingsDrawer` renders the three V6 cards and saves either batch settings or selected book overrides.
- Save feedback updates the parent batch and top production summary.

- [ ] **Step 1: Add failing assertions for V6 card order, fixed footer copy, field defaults, and scope selection.
- [ ] **Step 2: Run the focused test and verify failure.
- [ ] **Step 3: Implement the V6 two-column field layout, collapsible advanced/constraint cards, impact count, and fixed footer.
- [ ] **Step 4: Run focused UI contract and existing batch-factory tests.
- [ ] **Step 5: Commit `feat: align production settings with v6 drawer`.

### Task 3: Implement V6 Publish Drawer Boundary

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`
- Test: `tests/batch-factory-settings-drawers.test.js`

**Interfaces:**
- `PublishSettingsDrawer` reads/writes `batch.settings.publishSettings`.
- Publish entry point opens the drawer; no external publish success is reported without a 121 receipt.

- [ ] **Step 1: Add failing assertions for product settings, publish parameters, preview, and truthful unavailable publish state.
- [ ] **Step 2: Run the focused test and verify failure.
- [ ] **Step 3: Implement the three V6 publish cards, numeric bounds, toggles, preview, and save feedback.
- [ ] **Step 4: Run UI contract tests and build with `npm --prefix frontend run build`.
- [ ] **Step 5: Commit `feat: add truthful v6 publish settings drawer`.

### Task 4: Complete Runtime Prompt and Video Semantics

**Files:**
- Modify: `lib/batch-factory/video-prompt-compiler.js`
- Modify: `routes/batch-factory.js`
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Test: `tests/batch-factory-prompt-runtime.test.js`

**Interfaces:**
- `compileBatchFactoryVideo` returns a dynamic `compiledPrompt` snapshot while preserving `visualPrompt`.
- Video duration validation rejects values over the bound model capability.

- [ ] **Step 1: Add failing tests for injection toggles, prompt separation, duration bounds, and TTS non-mixing.**
- [ ] **Step 2: Run focused tests and verify failure.
- [ ] **Step 3: Implement minimal runtime compilation and validation.
- [ ] **Step 4: Run focused tests plus all batch-factory tests.
- [ ] **Step 5: Commit `fix: enforce batch factory prompt runtime contract`**.

### Task 5: Verify, Publish, and Browser-Check

**Files:**
- Modify: `tests/deploy-production.test.js` only if verification coverage is missing.
- Use: `scripts/deploy-production.sh`, `deploy/docker-compose.production.yml`.

- [ ] **Step 1: Run the complete batch-factory test set and frontend build.
- [ ] **Step 2: Run `bash scripts/deploy-production.sh preflight`.
- [ ] **Step 3: Run `bash scripts/deploy-production.sh publish`; preserve all production data volumes.
- [ ] **Step 4: Run `bash scripts/deploy-production.sh verify` and check `http://10.0.101.164:3000/batch-factory` returns 200.
- [ ] **Step 5: In the browser open both drawers, verify V6 card labels, save summary, and confirm publish remains truthful without a 121 receipt.
- [ ] **Step 6: Commit `chore: verify and publish batch factory v6 closure`.
