# 批量工厂框架功能闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变已确认四栏工作台布局的前提下，将批量工厂的真实数据、小说获取交接、提示词/前缀、生产和合并能力接入当前框架，并通过普通用户全流程验收。

**Architecture:** Node 的批量导演与生产编排保留现有路由；批次核心数据改经 Go 后端的受签名内部桥接写入 MySQL。当前 `BatchFactoryPreviewPage` 继续作为唯一可见框架，抽取现有 `BatchFactoryPage` 中可用的交接、折叠、状态和视频操作逻辑并嵌入各固定区域，不跳转到旧工作台页面。

**Tech Stack:** React/Vite、Ant Design、Express、Go Chi、MySQL 8、Node test、Go test、Docker Compose。

## Global Constraints

- 当前四栏框架、标题栏、金色入口和“批量工厂不在全局导航”不得修改；任何结构性变更需先获用户确认。
- 批次、书籍、设置快照、交接单、活动记录和生产回执写入 MySQL；不得继续为新增核心状态写 JSON。
- 所有 API 使用同源相对路径；按当前登录用户和团队隔离。
- 可见按钮必须调用真实能力并反馈结果；无法实现的动作必须禁用且说明原因。
- 121 上传/发布不在本计划中；仅在合并成片闭环验收后开始独立方案。
- 每个任务遵循测试先行、独立验证、独立提交；保留其他未提交用户文件。

---

## File Structure

- `backend/internal/storage/migrations.go`: 增加批量工厂 MySQL 表与索引迁移。
- `backend/internal/httpapi/batch_factory_handlers.go`: 提供内部桥接批次、交接单、书籍与活动记录 CRUD。
- `backend/internal/httpapi/router.go`: 注册受桥接签名保护的批量工厂数据端点。
- `lib/batch-factory/mysql-store.js`: Node 到 Go 的批次存储适配器，暴露异步 `getBatch`、`createBatch`、`updateItem` 等接口。
- `routes/batch-factory*.js`: 改用异步 MySQL 存储，不改变现有公开 API 路径。
- `frontend/src/user/pages/NovelFetchPage.jsx`: 为已完成任务添加“进入批量工厂”交接动作。
- `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`: 当前固定框架内接入交接、可折叠内容、前缀/提示词、视频与合并操作。
- `frontend/src/user/pages/batch-factory-preview.css`: 仅补充固定区域内部交互样式，不改变四栏网格、标题栏或入口样式。
- `test/batch-factory.test.js`: 存储、交接、模型时长与前缀编译契约。
- `tests/batch-factory-workbench-ui.test.js`: 固定布局、折叠、按钮接线、交接入口与无假按钮契约。
- `backend/internal/httpapi/batch_factory_handlers_test.go`: MySQL/桥接所有权和幂等性测试。

### Task 1: MySQL 批次存储与异步 Node 适配

**Files:**
- Modify: `backend/internal/storage/migrations.go`, `backend/internal/httpapi/router.go`
- Create: `backend/internal/httpapi/batch_factory_handlers.go`, `backend/internal/httpapi/batch_factory_handlers_test.go`, `lib/batch-factory/mysql-store.js`
- Modify: `routes/batch-factory.js`, `routes/batch-factory-intake.js`, `routes/batch-factory-production.js`, `test/batch-factory.test.js`

**Interfaces:**
- Consumes: 已有 `X-Qiantie-*` 内部桥接签名与当前用户身份。
- Produces: `createMySQLBatchFactoryStore(options)`，其异步接口为 `createNovelFetchIntake(username, payload)`, `getIntake(username, id)`, `createBatch(username, payload)`, `listBatches(username)`, `getBatch(username, id)`, `updateItem(username, batchId, itemId, updater)`, `appendItemActivity(username, batchId, itemId, event)`。

- [ ] **Step 1: 写失败的 Go 迁移/所有权测试**

```go
func TestBatchFactoryBridgeRejectsForeignBatch(t *testing.T) {
  // owner A creates batch; owner B reads /api/internal/batch-factory/batches/{id}.
  // Expect HTTP 404, never a record from owner A.
}

func TestBatchFactoryMigrationCreatesBatchAndItemTables(t *testing.T) {
  migration := migrationForVersion(t, 36)
  for _, table := range []string{"batch_factory_batches", "batch_factory_items", "batch_factory_intakes", "batch_factory_activity_logs"} {
    if !strings.Contains(migration.sql, table) { t.Fatalf("missing %s", table) }
  }
}
```

- [ ] **Step 2: 运行测试确认缺少迁移和桥接端点**

Run: `go test ./backend/internal/httpapi ./backend/internal/storage -run 'TestBatchFactory'`

Expected: FAIL because migration 36 and internal batch-factory handlers do not exist.

- [ ] **Step 3: 实现最小 MySQL 数据模型和桥接端点**

```sql
CREATE TABLE IF NOT EXISTS batch_factory_batches (
  id VARCHAR(80) PRIMARY KEY, owner_id BIGINT NOT NULL, name VARCHAR(80) NOT NULL,
  mode VARCHAR(16) NOT NULL, settings_json JSON NOT NULL, source_intake_id VARCHAR(80),
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  INDEX idx_batch_factory_batches_owner_updated (owner_id, updated_at)
);
CREATE TABLE IF NOT EXISTS batch_factory_items (
  id VARCHAR(80) PRIMARY KEY, batch_id VARCHAR(80) NOT NULL, ordinal INT NOT NULL,
  payload_json JSON NOT NULL, status VARCHAR(48) NOT NULL, created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL, UNIQUE KEY uq_batch_factory_item_ordinal (batch_id, ordinal)
);
```

Implement every handler with owner lookup before read/update and transactions for batch+items and intake consumption. The Node adapter serializes updater mutations through `PUT /api/internal/batch-factory/batches/:batchId/items/:itemId`; callers await every store method before enqueueing work.

- [ ] **Step 4: 改造 Node 路由调用点为 await**

```js
const batch = await store.getBatch(req.username, req.params.batchId);
await store.updateItem(req.username, batch.id, item.id, target => {
  target.status = 'queued_director';
  target.error = '';
});
```

Ensure queue workers re-read an item after each remote mutation and return the refreshed batch in public route responses.

- [ ] **Step 5: 运行 MySQL/Node 定向测试**

Run: `go test ./backend/internal/httpapi ./backend/internal/storage -run 'TestBatchFactory' && node --test test/batch-factory.test.js`

Expected: PASS; no test imports `lib/batch-factory/store.js` for new writes.

- [ ] **Step 6: 提交**

```bash
git add backend/internal/storage/migrations.go backend/internal/httpapi/router.go backend/internal/httpapi/batch_factory_handlers.go backend/internal/httpapi/batch_factory_handlers_test.go lib/batch-factory/mysql-store.js routes/batch-factory.js routes/batch-factory-intake.js routes/batch-factory-production.js test/batch-factory.test.js
git commit -m "feat: persist batch factory data in mysql"
```

### Task 2: 小说获取完成任务交接到当前框架

**Files:**
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`, `frontend/src/shared/api/batchFactory.js`, `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`, `test/batch-factory.test.js`

**Interfaces:**
- Consumes: `createBatchFactoryNovelFetchIntake({ name, items })` where each item includes `sourceTaskId`, `bookId`, `title`, `platform`, `sourceText`, `txtText`, `sourceMetadata`.
- Produces: a redirect to `/batch-factory?intake={id}`; the fixed framework consumes intake, creates its batch with the selected/default model, and selects the first imported item.

- [ ] **Step 1: 写失败的 UI/交接契约测试**

```js
test('completed novel-fetch tasks transfer into batch factory', () => {
  assert.match(novelFetchSource, /createBatchFactoryNovelFetchIntake/);
  assert.match(novelFetchSource, /进入批量工厂/);
  assert.match(previewSource, /getBatchFactoryIntake/);
  assert.match(previewSource, /sourceIntakeId/);
});
```

- [ ] **Step 2: 运行测试确认当前页面未接线**

Run: `node --test tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js`

Expected: FAIL because `NovelFetchPage` has no `createBatchFactoryNovelFetchIntake` action and preview frame ignores `intake`.

- [ ] **Step 3: 实现选择、校验和跳转**

```js
const completed = selectedTasks.filter(task => task.status === 'done' && task.original);
const { redirectTo } = await createBatchFactoryNovelFetchIntake({
  name: `小说获取转入 ${completed.length} 本`,
  items: completed.map(task => ({ sourceTaskId: task.bookId, bookId: task.bookId, title: task.bookName || task.bookId, platform: task.platformName || '', sourceText: task.original, txtText: task.original, sourceMetadata: task.meta || {} }))
});
window.history.pushState({}, '', redirectTo);
window.dispatchEvent(new PopStateEvent('popstate'));
```

Disable the action when no completed selected task has source text; show the exact count of skipped incomplete tasks. In the frame, read the query once, fetch the intake, create the batch only when `batchId` is empty, then remove `intake` from the URL after success.

- [ ] **Step 4: 运行交接测试**

Run: `node --test tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js`

Expected: PASS; an already consumed intake opens its existing batch instead of creating another.

- [ ] **Step 5: 提交**

```bash
git add frontend/src/user/pages/NovelFetchPage.jsx frontend/src/shared/api/batchFactory.js frontend/src/user/pages/BatchFactoryPreviewPage.jsx tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js
git commit -m "feat: transfer fetched novels into batch factory"
```

### Task 3: 在固定四栏框架中接入折叠、前缀、提示词、生产和合并

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`, `frontend/src/user/pages/batch-factory-preview.css`, `frontend/src/shared/api/batchFactory.js`
- Reuse: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`, `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`, `test/batch-factory.test.js`

**Interfaces:**
- Consumes: active batch, `compileBatchFactoryVideo`, `generateBatchFactoryVideos`, `generateBatchFactoryBatch`, `mergeBatchFactoryVideos`, `getBatchFactoryProductionStatus`.
- Produces: one actual player selection state per book, controlled collapse keys for five content groups, and visible operation controls whose disabled state comes from API readiness.

- [ ] **Step 1: 写失败的框架内功能测试**

```js
test('fixed frame exposes controlled collapses and real prefix prompt inspection', () => {
  for (const label of ['原文', '爆款钩子', '人物 / 场景 / 道具', 'VIDEO 提示词', '操作记录']) assert.match(previewSource, new RegExp(label));
  assert.match(previewSource, /activeKey=.*openSections|openSections/);
  assert.match(previewSource, /prefix_key/);
  assert.match(previewSource, /compileBatchFactoryVideo/);
});

test('visible frame actions are wired or explicitly disabled with a reason', () => {
  assert.match(previewSource, /generateBatchFactoryVideos/);
  assert.match(previewSource, /mergeBatchFactoryVideos/);
  assert.match(previewSource, /title="[^"]+"/);
});
```

- [ ] **Step 2: 运行测试确认框架存在展示型操作**

Run: `node --test tests/batch-factory-workbench-ui.test.js`

Expected: FAIL because the active preview frame does not display actual prefix key/version, batch merge request state, or a complete per-button contract.

- [ ] **Step 3: 在各固定区域写最小功能接线**

```jsx
<button onClick={() => toggleSection('video-prompts')} aria-expanded={openSections.includes('video-prompts')}>
  <Video size={16} /> VIDEO 提示词 <ChevronDown size={15} />
</button>
{openSections.includes('video-prompts') && storyboard.map((video, index) => (
  <Button key={video.id} onClick={() => viewVideoPrompt(video.id)}>
    VIDEO {String(index + 1).padStart(2, '0')} · {video.duration_sec}s · {video.prefix_key}
  </Button>
))}
```

Reuse the existing merge status resolver and API payload shape `{ projectId, bookId, mediaIds, speed }`. The player remains in the third column. Do not import the old workbench grid or its page shell.

- [ ] **Step 4: 为每个可见操作补齐状态与失败反馈**

Map: start director -> queue + refresh; generate one/batch -> queue + refresh; retry -> force regeneration + refresh; view prompt -> compile modal with prefix key/version; merge one/batch -> running indicator + result/download; publish -> disabled with 121 boundary; configuration save -> MySQL result + refreshed summary. Buttons not backed by an endpoint remain disabled with a reason in `title`.

- [ ] **Step 5: 运行 UI 和生产契约测试**

Run: `node --test tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js`

Expected: PASS; no frame control has an enabled click handler that returns without request or state change.

- [ ] **Step 6: 提交**

```bash
git add frontend/src/user/pages/BatchFactoryPreviewPage.jsx frontend/src/user/pages/batch-factory-preview.css frontend/src/shared/api/batchFactory.js frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js
git commit -m "feat: wire batch factory functions into fixed frame"
```

### Task 4: 普通用户流程模拟与发布验收

**Files:**
- Modify: `tests/batch-factory-workbench-ui.test.js`, `test/batch-factory.test.js`
- Create: `docs/superpowers/audits/2026-08-27-batch-factory-user-flow.md`

**Interfaces:**
- Consumes: Task 1-3 APIs and fixed-frame UI.
- Produces: each user action’s request, visible result, and failure result evidence; a list of removed or corrected unusable controls.

- [ ] **Step 1: 写失败的完整路径契约**

```js
test('ordinary user flow keeps frame and reaches merge-ready state', async () => {
  const intake = await api.createNovelFetchIntake(user, completedTasks);
  const batch = await api.consumeIntake(user, intake.id, model);
  await api.startDirector(user, batch.id);
  await api.submitVideos(user, batch.id, model.id);
  assert.equal(await api.mergeEligibility(user, batch.id), 'ready_merge');
});
```

- [ ] **Step 2: 运行测试确认任意断点**

Run: `node --test test/batch-factory.test.js tests/batch-factory-workbench-ui.test.js`

Expected: FAIL until the selected flow reaches batch creation, item status updates, and merge eligibility without JSON state.

- [ ] **Step 3: 以普通账号执行流程并记录证据**

Use a non-owner test account and two completed novel-fetch tasks. Record each action as `入口 -> API -> visible state -> error behavior` in the audit. Do not claim provider video generation or 121 publishing unless a real provider/121 receipt is returned.

- [ ] **Step 4: 修正审计发现的假按钮或断链**

For every issue, add one regression assertion before code. If an endpoint is absent, disable the control and document the exact missing dependency; do not retain an enabled no-op.

- [ ] **Step 5: 完整验证与 Docker 发布**

Run: `go test ./backend/internal/httpapi ./backend/internal/storage && node --test test/batch-factory.test.js tests/batch-factory-workbench-ui.test.js && npm --prefix frontend run build && docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml config --quiet && bash scripts/deploy-test-docker.sh up && curl -fsS http://127.0.0.1:14000/healthz && curl -fsS -o /dev/null -w '%{http_code}\n' http://10.0.101.164:3000/batch-factory`

Expected: all focused tests/build/compose checks pass, health returns `{\"ok\":true}`, page returns `200`.

- [ ] **Step 6: 提交与同步**

```bash
git add tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js docs/superpowers/audits/2026-08-27-batch-factory-user-flow.md
git commit -m "test: verify batch factory ordinary user flow"
git push origin integration/remote-workbench-20260819
```

## Self-Review

- Spec coverage: Task 1 replaces prohibited JSON state; Task 2 closes novel-fetch intake; Task 3 embeds all existing production behavior without changing the frame; Task 4 runs the requested ordinary-user audit and release evidence.
- Placeholder scan: the plan defines concrete endpoints, data fields, action mappings, tests and commands; 121 is deliberately excluded rather than deferred ambiguously.
- Type consistency: all Node store calls are async after Task 1; the intake payload in Task 2 uses the same source fields consumed by the MySQL store; Task 3 uses existing production API payloads.
