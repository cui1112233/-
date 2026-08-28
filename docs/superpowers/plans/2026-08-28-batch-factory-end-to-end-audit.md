# 批量工厂端到端流程审计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复并验证批量工厂从小说获取到 121 发布回执的完整真实链路，使每道流程门都有可执行、可恢复、可追踪的证据。

**Architecture:** 先以现有 Node 测试契约锁定 API、数据和页面边界，再用 1 本小说跑真实链路。每道流程门独立记录批次/书籍/VIDEO 标识、接口结果和持久化状态；发布先停在预览校验，只有明确确认后才提交 121。

**Tech Stack:** Express、React/Vite、Node `node:test`、MySQL batch-factory store、Docker Compose、豆包本地执行器、121 发布桥接接口。

## Global Constraints

- 测试只使用 1 本小说，优先控制为 1 个 VIDEO。
- 不删除或覆盖现有批次；使用独立测试批次名称。
- 每本小说必须保留 `sourceTaskId`、`bookId`、标题、平台、元数据和独立 TXT。
- `visualPrompt` 与动态生成的 `compiledPrompt` 必须保持数据边界，不得互相覆盖。
- 只有真实发布成功才进入终态；已合并不等于已完成发布。
- 未经再次确认不得提交 121，只执行发布预览和计划校验。
- 每项修改先写失败测试，再写最小实现，再运行针对性测试并提交。

---

### Task 1: 建立当前基线与测试批次隔离

**Files:**
- Modify: `tests/batch-factory-end-to-end-audit.test.js`
- Test: `tests/batch-factory-end-to-end-audit.test.js`

**Interfaces:**
- Consumes: `frontend/src/shared/api/batchFactory.js` 的批量工厂接口契约、`routes/batch-factory.js` 的阶段状态。
- Produces: 可复用的测试批次命名规则、阶段证据记录结构和失败门分类。

- [ ] **Step 1: Write the failing test**

  为测试辅助函数定义固定结构：`recordGate(gate, input, response, persisted, nextAction)`；断言测试名称含独立前缀，且不复用已有批次 ID。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js`

  Expected: FAIL，因为测试辅助函数和独立批次隔离断言尚不存在。

- [ ] **Step 3: Write minimal implementation**

  增加仅供测试使用的 `createAuditEvidence()` 和 `auditBatchName()`，不修改生产数据路径；批次名格式固定为 `E2E-AUDIT-YYYYMMDD-HHmm`。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js`

  Expected: PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add tests/batch-factory-end-to-end-audit.test.js
  git commit -m "test: add isolated batch factory audit harness"
  ```

### Task 2: 修复现有批量工厂契约失败

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`（仅修复批量工厂/账号中心路由契约所需的导航边界）
- Modify: `lib/batch-factory/store.js`（发布设置数值范围和默认值）
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`（V6 生产设置字段命名和选择器）
- Test: `tests/batch-factory-current-mainline-contract.test.js`
- Test: `tests/batch-factory-settings-contract.test.js`
- Test: `tests/batch-factory-v6-completeness.test.js`

**Interfaces:**
- Consumes: `updateBatchFactorySettings(batchId, settings)`、`publishBatchFactory(batchId, payload)`。
- Produces: 通过现有 3 个失败契约，且不改变个人中心路由和发布计划接口。

- [ ] **Step 1: Write the failing test**

  将失败断言明确化：导航必须包含 `/batch-factory`，发布设置必须限制 `mergeSpeed`、`scrollCount`、`generateCount`、`unpackSpeed`、`pitch`，生产抽屉必须同时暴露生产方式、视频模型、剧本预设和人物场景预设。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/batch-factory-current-mainline-contract.test.js tests/batch-factory-settings-contract.test.js tests/batch-factory-v6-completeness.test.js`

  Expected: FAIL with the current three contract failures。

- [ ] **Step 3: Write minimal implementation**

  只修复断言涉及的边界；保持 `UserLayout` 的账号中心路由独立，按 `store.js` 的现有规范归一化发布数值，并让生产抽屉使用 V6 的选择器/时长策略文案。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-current-mainline-contract.test.js tests/batch-factory-settings-contract.test.js tests/batch-factory-v6-completeness.test.js`

  Expected: 3 个测试文件全部 PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/shared/layouts/UserLayout.jsx frontend/src/user/pages/BatchFactoryPreviewPage.jsx lib/batch-factory/store.js tests/batch-factory-current-mainline-contract.test.js tests/batch-factory-settings-contract.test.js tests/batch-factory-v6-completeness.test.js
  git commit -m "fix: align batch factory contracts with v6 flow"
  ```

### Task 3: 验证获取门、批次门和导演门

**Files:**
- Modify: `tests/batch-factory-end-to-end-audit.test.js`
- Reference: `routes/novel-fetch.js`, `routes/batch-factory.js`, `lib/batch-factory/store.js`

**Interfaces:**
- Consumes: 小说获取完成任务、`/api/batch-factory/intakes/novel-fetch`、`POST /api/batch-factory/batches`、`POST /api/batch-factory/batches/:batchId/start`。
- Produces: 获取门/批次门/导演门的证据记录和可恢复失败分类。

- [ ] **Step 1: Write the failing test**

  针对单本测试小说断言：转入 intake 后 TXT 与 `bookId` 一一对应；创建批次后设置可回读；开始导演后状态只允许进入已定义的 queued/generating/complete/failed 集合。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="获取门|批次门|导演门"`

  Expected: FAIL until the harness is wired to the running API and persisted readback。

- [ ] **Step 3: Write minimal implementation**

  用现有测试 HTTP 客户端和账号会话调用接口；每次响应后重新读取批次，不从前端临时状态推断成功。爆款模式额外断言 `hook_review` 在导演前出现。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="获取门|批次门|导演门"`

  Expected: PASS，或输出明确的阻断门与接口证据。

- [ ] **Step 5: Commit**

  ```bash
  git add tests/batch-factory-end-to-end-audit.test.js
  git commit -m "test: audit intake batch and director gates"
  ```

### Task 4: 验证生产门与 VIDEO Prompt 边界

**Files:**
- Modify: `tests/batch-factory-end-to-end-audit.test.js`
- Reference: `routes/batch-factory.js`, `lib/batch-factory/video-prompt-compiler.js`, `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`

**Interfaces:**
- Consumes: `POST /batches/:batchId/items/:itemId/videos/:videoId/compile`、`POST /batches/:batchId/items/:itemId/generate`。
- Produces: `visualPrompt`、`compiledPrompt`、模型能力、VIDEO 生产任务 ID 的可追踪证据。

- [ ] **Step 1: Write the failing test**

  断言编译前后 `visualPrompt` 不变，`compiledPrompt` 含时长/画幅和启用的资产约束；生成请求使用批次绑定模型且不超过模型最大时长。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="生产门"`

  Expected: FAIL if any字段未持久化、模型能力缺失或任务 ID 不可回读。

- [ ] **Step 3: Write minimal implementation**

  仅补齐实际阻断点；禁止把前缀、资产长 Prompt、负面词写回 `visualPrompt`。生成后同时查询批量工厂批次和水货生产状态。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="生产门"`

  Expected: PASS 或给出生产提交/回调缺失的明确阻断证据。

- [ ] **Step 5: Commit**

  ```bash
  git add tests/batch-factory-end-to-end-audit.test.js
  git commit -m "test: audit video production prompt boundary"
  ```

### Task 5: 验证合并门与发布门（发布先预览）

**Files:**
- Modify: `tests/batch-factory-end-to-end-audit.test.js`
- Reference: `routes/batch-factory.js`, `lib/batch-factory/121-publish.js`, `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`

**Interfaces:**
- Consumes: 水货生产状态、`POST /api/shuihuo-production/batch-factory/merge-videos`、`POST /batches/:batchId/publish/preview`。
- Produces: 合并媒体记录、发布计划、MP4/TXT 映射和待确认发布状态。

- [ ] **Step 1: Write the failing test**

  断言合并只接受全部成功 VIDEO，媒体 ID 顺序与 storyboard 一致；发布预览必须要求组织/121 配置，并为每本书生成唯一 MP4/TXT 对。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="合并门|发布门"`

  Expected: FAIL until真实媒体和发布配置被读取并记录。

- [ ] **Step 3: Write minimal implementation**

  先调用发布预览，不调用正式发布；若合并或预览失败，记录原始错误、批次回读状态和重试动作。正式 121 提交保留为单独的用户确认步骤。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js --test-name-pattern="合并门|发布门"`

  Expected: 合并门 PASS；发布门至少达到“预览可执行”，正式提交状态为待用户确认。

- [ ] **Step 5: Commit**

  ```bash
  git add tests/batch-factory-end-to-end-audit.test.js
  git commit -m "test: audit merge and publish preview gates"
  ```

### Task 6: 浏览器、刷新和容器重启验收

**Files:**
- Modify: `tests/batch-factory-end-to-end-audit.test.js`
- Reference: `frontend/src/user/App.jsx`, `frontend/src/shared/api/client.js`, `deploy/docker-compose.production.yml`

**Interfaces:**
- Consumes: 实际 `http://10.0.101.122:3000` 页面、浏览器懒加载资源、已创建测试批次。
- Produces: 用户可见页面验收结果和重启后状态恢复证据。

- [ ] **Step 1: Write the failing test**

  为页面验收记录设置、水货生产、小说获取、批量工厂入口；断言懒加载资源返回 200，iframe `batch-rewrite/index.html` 返回 200，批次刷新后仍能读取。

- [ ] **Step 2: Run test to verify it fails**

  Run: `curl -fsS -o /dev/null -w '%{http_code}\n' http://10.0.101.122:3000/batch-rewrite/index.html`

  Expected: 若资源或镜像缓存异常则 FAIL；否则 PASS 并记录基线。

- [ ] **Step 3: Write minimal implementation**

  仅修复实际发现的资源缓存、路由或恢复问题；平台重建使用 `docker compose -p qiantie-production ... up -d --no-deps platform`，不重启数据库和 Redis。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/batch-factory-end-to-end-audit.test.js`，并复查 `docker ps`、页面路由和测试批次回读。

  Expected: 六道流程门均有状态证据；没有假成功；页面刷新/容器重启后批次仍可恢复。

- [ ] **Step 5: Commit**

  ```bash
  git add tests/batch-factory-end-to-end-audit.test.js
  git commit -m "test: verify batch factory browser and restart recovery"
  ```

## Final Verification

- [ ] Run all batch-factory tests: `node --test tests/batch-factory-*.test.js`
- [ ] Run frontend build: `npm run build` in `frontend/`
- [ ] Verify live routes return 200: `/`, `/novel-fetch`, `/batch-factory`, `/shuihuo-production`, `/settings`
- [ ] Verify `batch-rewrite/index.html` returns 200 and is present in the running platform image
- [ ] Produce the six-gate audit report with explicit PASS/RECOVERABLE/BLOCKED/FAKE-SUCCESS outcomes
- [ ] Do not call formal 121 publish until user gives action-time confirmation after preview review
