# 批量工厂主入口收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/shuihuo-production`、`/batch-factory` 与小说获取交接共用同一个完整批量工厂工作台，不再通过旧水货生产外壳。

**Architecture:** 增加只读取 V12 批次、创建批次和处理 `intake` 交接的入口容器。容器选择批次后复用既有 `BatchFactoryNovelList`；两条路由均指向它，旧 `ShuihuoProductionPage` 不删除但不再承载批量入口。

**Tech Stack:** React、Ant Design、Vite、Node built-in test。

## Global Constraints

- 不删除或迁移已有批次、小说、资产、自动化预设或历史水货项目。
- 批量工厂入口不得调用 `listProjects`、`getProductionHealth` 或渲染 `CommentaryWorkbench`。
- 小说获取交接地址保持 `/shuihuo-production?intake=<id>`。
- 不改动单书的资产、导演、配音、VIDEO、合并、上传生产逻辑。

---

### Task 1: 锁定主入口契约

**Files:**
- Modify: `frontend/src/user/App.jsx`
- Test: `frontend/src/user/App.batch-factory-route.test.js`

**Interfaces:**
- Produces: `/shuihuo-production` 与 `/batch-factory` 指向同一懒加载页面组件。

- [ ] **Step 1: Write the failing route test**

```js
assert.match(app, /const BatchFactoryWorkbenchPage = lazy\(\(\) => import\('\.\/pages\/BatchFactoryWorkbenchPage'\)\)/);
assert.match(app, /'\/batch-factory': BatchFactoryWorkbenchPage/);
assert.match(app, /'\/shuihuo-production': BatchFactoryWorkbenchPage/);
assert.doesNotMatch(app, /BatchFactoryFromShuihuoPage/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/src/user/App.batch-factory-route.test.js`

Expected: FAIL because each route currently uses the old `ShuihuoProductionPage` composition.

- [ ] **Step 3: Replace the route composition**

```js
const BatchFactoryWorkbenchPage = lazy(() => import('./pages/BatchFactoryWorkbenchPage'));
// both route keys map to BatchFactoryWorkbenchPage
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `node --test frontend/src/user/App.batch-factory-route.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/App.jsx frontend/src/user/App.batch-factory-route.test.js
git commit -m "refactor(batch-factory): route both entries to one workbench"
```

### Task 2: 创建仅批量工厂的入口容器

**Files:**
- Create: `frontend/src/user/pages/BatchFactoryWorkbenchPage.jsx`
- Test: `frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js`

**Interfaces:**
- Consumes: `listBatches()`, `getBatch(batchId)`, `createManualIntake(input)`, `createBatchFromIntake(intakeId, input)`, `appendNovelFetchIntake(batchId, intakeId, input)`.
- Produces: `BatchFactoryWorkbenchPage`, which renders a batch home or `BatchFactoryNovelList`.

- [ ] **Step 1: Write the failing source test**

```js
assert.match(page, /listBatches\(\)/);
assert.match(page, /BatchFactoryCreateModal/);
assert.match(page, /BatchFactoryNovelList/);
assert.match(page, /pendingNovelFetchIntakeId\(window\.location\.search\)/);
assert.doesNotMatch(page, /listProjects\(/);
assert.doesNotMatch(page, /getProductionHealth\(/);
assert.doesNotMatch(page, /CommentaryWorkbench/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js`

Expected: FAIL because the container does not exist.

- [ ] **Step 3: Implement the container**

```jsx
export default function BatchFactoryWorkbenchPage() {
  // list V12 batches; open the selected batch in BatchFactoryNovelList
  // create a batch through BatchFactoryCreateModal
  // retain the existing intake create-or-append behavior and clear only the intake query on success
}
```

Use `batchFactoryBatchFromResponse` and `BATCH_FACTORY_ACTIVE_BATCH_STORAGE_KEY` for the same active-batch persistence already used by the former wrapper. Render a simple batch factory home with refresh, new-batch and batch cards; failed list reads must leave a retry button available.

- [ ] **Step 4: Run the source test to verify it passes**

Run: `node --test frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/BatchFactoryWorkbenchPage.jsx frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js
git commit -m "feat(batch-factory): add canonical workbench entry"
```

### Task 3: 浏览器样式和入口回归

**Files:**
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `frontend/src/user/pages/shuihuo-production-theme.source.test.js`

**Interfaces:**
- Consumes: the root class emitted by `BatchFactoryWorkbenchPage`.
- Produces: batch home and selected-batch workbench use the existing dark production theme without the legacy readiness strip.

- [ ] **Step 1: Write the failing theme test**

```js
assert.match(css, /\.batch-factory-workbench-home/);
assert.match(css, /\.batch-factory-workbench-grid/);
assert.doesNotMatch(page, /shuihuo-readiness-strip/);
```

- [ ] **Step 2: Run the source tests to verify failure**

Run: `node --test frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js frontend/src/user/pages/shuihuo-production-theme.source.test.js`

- [ ] **Step 3: Add minimal home styles**

Add responsive grid, batch-card, error and empty-state selectors beneath the existing batch-factory styles. Do not alter `BatchFactoryNovelList` table layout.

- [ ] **Step 4: Run targeted tests and frontend build**

Run: `node --test frontend/src/user/App.batch-factory-route.test.js frontend/src/user/pages/BatchFactoryWorkbenchPage.source.test.js frontend/src/user/pages/shuihuo-production-theme.source.test.js && npm --prefix frontend run build`

- [ ] **Step 5: Browser verification**

Open both `/shuihuo-production` and `/batch-factory` on `127.0.0.1:5173`. Confirm they display the same batch home, can create/open a batch, and that a valid `?intake=` still opens or appends to a batch.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/user/pages/shuihuo-production.css frontend/src/user/pages/shuihuo-production-theme.source.test.js
git commit -m "style(batch-factory): add canonical entry home"
```
