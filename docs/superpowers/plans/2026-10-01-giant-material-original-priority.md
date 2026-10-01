# 巨量素材正文优先方式开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“巨量获取”的立即执行流程中增加“优先直接获取原文”开关，让每本书在 OCR 优先或书城正文优先两条互斥路径中可靠完成正文读取。

**Architecture:** 青语解析继续负责书名、书城、Book ID 与视频地址；新开关保存到占位书的 `sourceMetadata.originalReadStrategy`。直接优先复用 V12 单书 `fetch-original` 接口且不创建执行器任务；OCR 优先失败时，进度组件自动用同一接口兜底。V12 回填路由必须合并巨量元数据。

**Tech Stack:** React + Ant Design、node:test、Node Express V12 路由、既有 Go V11 存储边界。

## Global Constraints

- 只作用于“巨量获取”本次创建的批量；默认 `ocr_first`，不改变 Windows/macOS 执行器偏好。
- 青语解析得到书名、书城和 Book ID；OCR 不得承担这些元数据识别。
- 不得并行运行 OCR 与书城取文，且不得覆盖非空 `sourceText`。
- 抓取失败不得伪造正文；只有正文成功保存后才启动分类和自动制作。
- 所有生产代码先进入 Git v88 lineage；不直接改公网。

---

## File Map

- `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.js`：巨量占位书的策略元数据。
- `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js`：策略元数据纯函数测试。
- `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`：开关与首次路径分派。
- `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`：弹窗行为防回归。
- `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.jsx`：OCR 失败兜底与人工恢复。
- `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js`：进度状态和按钮防回归。
- `routes/batch-factory-v12.js`：直接取文回填时保留巨量来源。
- `test/batch-factory-v12-direct-original.test.js`：Node 路由 helper 测试。
- `frontend/src/user/pages/shuihuo-production.css`：开关与恢复按钮样式。

## Persisted Interface

每本巨量占位书保存：

```js
{
  sourceMode: 'giant_material',
  originalReadStrategy: 'ocr_first' | 'direct_first',
  originalReadStage: 'pending' | 'ocr' | 'direct' | 'completed' | 'failed',
  originalReadError: '',
  contentPending: true
}
```

`fetchBookOriginal(batchId, bookId)` 是唯一直接取文浏览器 API。它只填充空正文，不启动 OCR。

### Task 1: 保存本次批量的读取策略

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.js`
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js`

**Consumes:** `buildGiantMaterialPlaceholderIntake(..., originalReadStrategy)`。
**Produces:** 每本占位书的策略、阶段与错误字段。

- [x] **Step 1: 写入失败测试**

在 `batchFactoryGiantMaterialImport.test.js` 导入两个 placeholder builder，添加：

```js
test('records OCR-first as the default giant placeholder strategy', () => {
  const payload = buildGiantMaterialPlaceholderIntake({
    giantMaterialId: '7689285397448523826', material, book: material.books[0]
  });
  assert.equal(payload.books[0].sourceMetadata.originalReadStrategy, 'ocr_first');
  assert.equal(payload.books[0].sourceMetadata.originalReadStage, 'pending');
  assert.equal(payload.books[0].sourceMetadata.originalReadError, '');
  assert.equal(payload.books[0].sourceMetadata.contentPending, true);
});

test('records direct-first for every book in a multi-ID giant intake', () => {
  const payload = buildGiantMaterialPlaceholderIntakes([
    { giantMaterialId: '7689285397448523826', material, book: material.books[0] },
    { giantMaterialId: '7689285397448523827', material, book: material.books[1] }
  ], { originalReadStrategy: 'direct_first' });
  assert.deepEqual(payload.books.map(book => book.sourceMetadata.originalReadStrategy), ['direct_first', 'direct_first']);
});
```

- [x] **Step 2: 确认测试失败**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js`
Expected: FAIL，字段尚不存在。

- [x] **Step 3: 最小实现**

在 import helper 增加：

```js
function originalReadStrategy(value) {
  return String(value || '').trim() === 'direct_first' ? 'direct_first' : 'ocr_first';
}
```

两个 placeholder builder 接受 `originalReadStrategy: requestedStrategy`。单书 `sourceMetadata` 写入：

```js
originalReadStrategy: strategy,
originalReadStage: 'pending',
originalReadError: '',
contentPending: true
```

多书 builder 必须把请求策略传给每个单书 builder。不要改变已有的、代表 OCR 已完成的 `buildGiantMaterialIntake`。

- [x] **Step 4: 验证并提交**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js`
Expected: PASS.

```bash
git add frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js
git commit -m "feat: persist giant original read strategy"
```

### Task 2: 直接取文成功后保留巨量来源

**Files:**
- Modify: `routes/batch-factory-v12.js`
- Create: `test/batch-factory-v12-direct-original.test.js`

**Consumes:** `refillMissingBatchFactoryBookSource`。
**Produces:** 保留巨量字段且将 direct fetch 标为已完成的 `captureSource` payload。

- [x] **Step 1: 写入失败测试**

创建 `test/batch-factory-v12-direct-original.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { refillMissingBatchFactoryBookSource } = require('../routes/batch-factory-v12');

test('direct retrieval preserves giant metadata and records bookstore completion', async () => {
  let captured;
  await refillMissingBatchFactoryBookSource({
    book: {
      id: 'book-1', bookId: '10122315', platform: '七猫', revision: 3, sourceText: '',
      sourceMetadata: { sourceMode: 'giant_material', giantMaterialId: '7689285397448523826', originalReadStrategy: 'direct_first', originalReadStage: 'direct', contentPending: true }
    },
    platforms: [{ id: '1', name: '七猫' }],
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    fetchDirectOriginal: async () => ({ text: '书城正文', attempts: 1, bookinfo: { work_title: '原书名' } }),
    captureSource: async payload => { captured = payload; return { book: payload }; }
  });
  assert.equal(captured.sourceText, '书城正文');
  assert.equal(captured.sourceMetadata.sourceMode, 'giant_material');
  assert.equal(captured.sourceMetadata.giantMaterialId, '7689285397448523826');
  assert.equal(captured.sourceMetadata.originalReadStage, 'completed');
  assert.equal(captured.sourceMetadata.originalReadVia, 'bookstore');
  assert.equal(captured.sourceMetadata.contentPending, false);
});
```

再添加一例非空 `sourceText`，断言抛出 `当前书已有正文，不能覆盖` 且不调用 `fetchDirectOriginal`。

- [x] **Step 2: 确认测试失败**

Run: `node --test test/batch-factory-v12-direct-original.test.js`
Expected: FAIL，因为当前 helper 把来源写为 `manual_refetched`。

- [x] **Step 3: 合并元数据**

在 `refillMissingBatchFactoryBookSource` 中建立：

```js
const existingMetadata = book?.sourceMetadata && typeof book.sourceMetadata === 'object'
  ? book.sourceMetadata
  : {};
const isGiant = existingMetadata.sourceMode === 'giant_material';
const nextMetadata = {
  ...existingMetadata,
  sourceMode: isGiant ? 'giant_material' : 'manual_refetched',
  sourceFetchedAt: now().toISOString(),
  sourceFetchAttempts: Number(fetched?.attempts || 0),
  sourceCaptureCharacters: maxTxt,
  sourceBookId: bookId,
  ...(isGiant ? {
    originalReadStage: 'completed',
    originalReadVia: 'bookstore',
    originalReadError: '',
    contentPending: false
  } : {}),
  ...(fetched?.bookinfo?.work_title ? { sourceBookTitle: String(fetched.bookinfo.work_title) } : {})
};
```

把它传给 `captureSource`。保留现有“正文非空即拒绝”和 HTTP 状态码逻辑。

- [x] **Step 4: 验证并提交**

Run:

```bash
node --test test/batch-factory-v12-direct-original.test.js frontend/src/shared/api/batchFactoryV11.test.js
git add routes/batch-factory-v12.js test/batch-factory-v12-direct-original.test.js
git commit -m "fix: retain giant source metadata after direct fetch"
```

Expected: PASS.

### Task 3: 弹窗增加开关，并且只启动一种首次读取方式

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Consumes:** Task 1 metadata；已有 `fetchBookOriginal`、`createGiantMaterialJob`、`getBatch`。
**Produces:** direct-first 不创建 executor job；ocr-first 正常创建 executor job。

- [x] **Step 1: 写入失败的源码测试**

在 `BatchFactoryCreateModal.source.test.js` 加入：

```js
assert.match(source, /优先直接获取原文/);
assert.match(source, /const \[giantOriginalReadStrategy, setGiantOriginalReadStrategy\] = useState\('ocr_first'\)/);
assert.match(source, /originalReadStrategy: giantOriginalReadStrategy/);
assert.match(source, /giantOriginalReadStrategy === 'direct_first'/);
assert.match(source, /await fetchBookOriginal\(batchId, book\.id\)/);
assert.match(source, /await createGiantMaterialJob\(/);
assert.match(source, /if \(giantOriginalReadStrategy === 'direct_first'\)[\s\S]{0,2500}else[\s\S]{0,2500}createGiantMaterialJob/);
```

- [x] **Step 2: 确认测试失败**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
Expected: FAIL，开关和分支不存在。

- [x] **Step 3: 新增 UI 状态**

从 Antd 导入 `Switch`；添加：

```js
const [giantOriginalReadStrategy, setGiantOriginalReadStrategy] = useState('ocr_first');
```

在 `reset()` 恢复 `ocr_first`。仅在 `isGiantMaterial` 时渲染：

```jsx
<Switch checked={giantOriginalReadStrategy === 'direct_first'}
  onChange={checked => setGiantOriginalReadStrategy(checked ? 'direct_first' : 'ocr_first')} />
<span>优先直接获取原文</span>
<small>{giantOriginalReadStrategy === 'direct_first'
  ? '先通过书城和 Book ID 获取正文；失败后可手动改用滚屏 OCR。'
  : '先读取视频滚屏；失败后自动通过书城获取正文。'}</small>
```

将策略传入 `buildGiantMaterialPlaceholderIntakes`。

- [x] **Step 4: 实现互斥分派**

创建批量后，逐本刷新最新 batch/book 并保存 `originalReadStage: 'direct'` 或 `'ocr'`、保留 `giantAutomationPlan`。

- `direct_first`：仅调用 `await fetchBookOriginal(batchId, book.id)`。成功后刷新、分类并按既有计划启动自动制作；失败只更新 `originalReadStage: 'failed'` 与 `originalReadError`，**绝不调用** `createGiantMaterialJob`。
- `ocr_first`：保留创建 executor job 的已有实现，并写入 `executorJobId` 和 `originalReadStage: 'ocr'`。
- 只在至少一个 OCR-first 项目时检查 `executorHealth.online`；direct-first 允许没有执行器。
- 每项保留独立 catch，避免一条失败阻断同批其他 ID。

添加暗色主题复用变量的 `.batch-factory-giant-read-strategy` 样式。

- [x] **Step 5: 验证并提交**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js
cd frontend && npm run build
git add frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: choose giant original acquisition priority"
```

Expected: PASS.

### Task 4: OCR 失败自动兜底；直接优先失败人工恢复

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js`

**Consumes:** Task 1 策略、Task 2 直接取文结果、已有 job API。
**Produces:** ocr-first 的一次自动兜底，direct-first 的两个手动恢复按钮。

- [x] **Step 1: 写入失败源码测试**

在 `BatchFactoryGiantMaterialFlow.source.test.js` 添加：

```js
const progress = read('BatchFactoryGiantMaterialPendingProgress.jsx');
assert.match(progress, /originalReadStrategy/);
assert.match(progress, /if \(originalReadStrategy === 'ocr_first'\)[\s\S]{0,1600}fetchBookOriginal/);
assert.match(progress, /重试获取原文/);
assert.match(progress, /改用滚屏 OCR/);
assert.match(progress, /createGiantMaterialJob/);
assert.match(progress, /originalReadStage: 'failed'/);
```

- [x] **Step 2: 确认测试失败**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js`
Expected: FAIL，当前仅有一个“原文获取”按钮。

- [x] **Step 3: 实现一次性自动书城兜底**

新增组件内 `fetchDirectOriginal({ automatic = false })`：

1. 使用 state 防止并发；刷新 batch，按 giantMaterialId 找最新书。
2. 非空正文立即成功返回，不进行写入。
3. 保存 `originalReadStage: 'direct'`，清空错误，再调用 `fetchBookOriginal(batchId, latestBook.id)`。
4. 成功后刷新内容；失败写入 `originalReadStage: 'failed'` 和错误文本，保留 `contentPending: true`。
5. executor job 变为 `failed/cancelled` 时，先写 OCR 错误；仅 `ocr_first` 使用按 jobId 去重的 ref 自动调用一次 `fetchDirectOriginal({ automatic: true })`。

- [x] **Step 4: 实现人工恢复**

错误状态渲染：

```jsx
<Space size="small">
  <Button size="small" type="primary" loading={refetching} onClick={() => fetchDirectOriginal()}>重试获取原文</Button>
  <Button size="small" disabled={ocrStarting} onClick={startOcrFallback}>改用滚屏 OCR</Button>
</Space>
```

`startOcrFallback` 刷新 book，遇到非空正文直接返回；否则从持久化 `giantMaterialId/platformBookId/sourceBookTitle/videoUrl/contentRangeLines` 创建 job，再原子写入 `executorJobId`、`originalReadStage: 'ocr'`、清空错误和 `contentPending: true`。无在线执行器时显示“等待执行器”，不假报 OCR 失败。

OCR 成功回填时额外写入：

```js
originalReadStage: 'completed',
originalReadVia: 'ocr',
originalReadError: '',
contentPending: false
```

- [x] **Step 5: 验证并提交**

Run:

```bash
node --test frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js
cd frontend && npm run build
git add frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.jsx frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js
git commit -m "feat: recover giant original reads by strategy"
```

Expected: PASS.

### Task 5: Scoped regression and Git-first handoff

**Files:** No production file changes unless a test exposes a defect.

- [x] **Step 1: Run scoped regression**

```bash
node --test \
  frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js \
  frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js \
  frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js \
  frontend/src/shared/api/batchFactoryV11.test.js \
  test/batch-factory-v12-direct-original.test.js
cd frontend && npm run build
```

Expected: PASS. 如有无关的全库失败，记录其实际边界，不宣称全库通过。

- [x] **Step 2: 复核互斥和来源保护**

Run:

```bash
git diff origin/v88...HEAD -- frontend/src/user/pages/shuihuo routes/batch-factory-v12.js test
git diff --check origin/v88...HEAD
```

确认：direct-first 不会在用户点击“改用滚屏 OCR”前创建 job；ocr-first 只在终态失败后取书城正文；直接取文保留 `sourceMode: 'giant_material'`；两条成功路径才启动分类/自动制作。

- [ ] **Step 3: 交付**

提交任何验证发现的最小修正，报告 branch SHA、测试和 build 结果、以及“书城上游可用性仍是外部依赖”。待合入最新 v88 后，才按精确 SHA 发布公网。
