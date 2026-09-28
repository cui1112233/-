# 小说获取处理流与任务可观测性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小说获取的模型默认值、按书队列控制、当前批次日志和全局任务中心做成一致且可验证的生产流程。

**Architecture:** 保留 V78 页面和 V2 覆盖层。V2 负责处理页控件和任务显示；V2 API、队列和 runner 负责可靠执行。入队 payload 固化模型，所有状态按 book ID 关联。

**Tech Stack:** Node.js CommonJS、Express、浏览器原生 JavaScript、Node test runner。

## Global Constraints

- 所有代码先进入 Git `v88`，测试通过、记录精确 SHA 后才按 Git-direct 发布。
- 模型下拉只显示 `GET /api/models?kind=text` 的可见模型；绝不返回凭据。
- 用户模型选择立即成为未来批次默认值；已入队的 `text_model_id` 不随默认值变化。
- 上游认证、配额或模型错误必须保留为阶段错误，至多三次重试，等待用户显式重试；禁止静默替换模型。
- 处理页只显示当前批次；任务页才是全局队列和历史任务中心。
- 删除立即停止 queued/waiting-retry；running 书在安全阶段边界停止，已完成数据保留。
- 保留真实原文计数、分类、AI 和 121 状态；不伪造成功或日期。

---

## File Structure

- `frontend/public/batch-rewrite/app.js`：已有文本模型读取与默认配置保存。
- `public/batch-rewrite/v78-novel-fetch-v2.js`：模型下拉、当前批次日志、任务中心 UI。
- `lib/novel-fetch-workshop/queue.js`：队列模型快照、停止请求、重试、进度。
- `lib/novel-fetch-workshop/v2-api-contract.js`：V2 请求、状态与停止接口。
- `lib/novel-fetch-workshop/v2-batch-executor.js`：使用已固化模型。
- `lib/novel-fetch-workshop/runner.js`：按书阶段边界和进度上报。
- `lib/novel-fetch-workshop/task-ops.js`：任务展示数据合并。
- `lib/novel-fetch-workshop/v2-page.js`：浏览器资源缓存版本。

### Task 1: 处理页模型下拉与队列模型快照

**Files:**
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js:currentWorkSnapshot`
- Modify: `frontend/public/batch-rewrite/app.js:loadTextModels`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js:normalizeProcessPayload,batchSettingsSnapshot`
- Modify: `lib/novel-fetch-workshop/v2-batch-executor.js:withQueuedTextModelSnapshot`
- Test: `lib/novel-fetch-workshop/v2-api-contract.test.js`, `test/novel-fetch-progressive-queue.test.js`

**Interfaces:**
- Produces: `ProcessPayload.text_model_id: string`; `QueueItem.payload.text_model_id: string`.

- [ ] **Step 1: Write the failing request-normalization test**

```js
test('normalizes a selected model ID and rejects an object', () => {
  assert.equal(normalizeProcessPayload({ text_model_id: 'text-a' }).text_model_id, 'text-a');
  assert.equal(normalizeProcessPayload({ text_model_id: { id: 'bad' } }).text_model_id, '');
});
```

- [ ] **Step 2: Run the focused test**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/v2-api-contract.test.js`

Expected: FAIL before implementation.

- [ ] **Step 3: Add strict normalizer and settings snapshot**

```js
function normalizeTextModelId(value) {
  return typeof value === 'string' ? value.trim() : '';
}
// normalizeProcessPayload
text_model_id: normalizeTextModelId(body.text_model_id)
```

Add the same field to `batchSettingsSnapshot(payload)`. Executor resolves `payload.text_model_id` before current app config and never writes into payload.

- [ ] **Step 4: Add selector beside version configuration**

```js
select.id = 'v78ProcessingTextModel';
select.onchange = async () => {
  await persistSelectedTextModel(select.value);
  setText('v78ProcessingTextModelStatus', '已保存为后续批次默认文本模型');
};
```

Reuse `loadTextModels` output; select saved default or first visible model once. `currentWorkSnapshot()` includes selected `text_model_id`.

- [ ] **Step 5: Add immutable-snapshot regression**

```js
test('queued work keeps its model after a later default change', async () => {
  const job = await startWithPayload({ text_model_id: 'text-a' });
  await saveDefaultModel('text-b');
  await executeQueuedItem(job.id);
  assert.equal(executions[0].payload.text_model_id, 'text-a');
});
```

- [ ] **Step 6: Run and commit**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-progressive-queue.test.js`

Expected: PASS.

```bash
git add frontend/public/batch-rewrite/app.js public/batch-rewrite/v78-novel-fetch-v2.js lib/novel-fetch-workshop/v2-api-contract.js lib/novel-fetch-workshop/v2-batch-executor.js lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-progressive-queue.test.js
git commit -m "feat(novel-fetch): select and snapshot processing text model"
```

### Task 2: 按书安全停止和删除

**Files:**
- Modify: `lib/novel-fetch-workshop/queue.js`, `lib/novel-fetch-workshop/v2-runtime.js`, `lib/novel-fetch-workshop/runner.js`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js:stop-selected,batch-delete-permanent`
- Test: `lib/novel-fetch-workshop/queue.test.js`, `lib/novel-fetch-workshop/v2-api-contract.test.js`, `test/novel-fetch-retry-stage.test.js`

**Interfaces:**
- Produces: `queue.isBookStopRequested(owner, bookId): boolean` and `runner.executeBatch(..., { shouldStop(bookId) })`.

- [ ] **Step 1: Write the failing queue test**

```js
test('cancelBooks stops queued work and marks a running book for safe stop', () => {
  const output = queue.cancelBooks('alice', ['queued-book', 'running-book']);
  assert.equal(output.cancelledItemIds.length, 1);
  assert.deepEqual(output.stopRequestedBookIds, ['running-book']);
  assert.equal(queue.isBookStopRequested('alice', 'running-book'), true);
});
```

- [ ] **Step 2: Run it**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/queue.test.js`

Expected: FAIL before per-book requests exist.

- [ ] **Step 3: Persist per-owner stop requests**

```js
state.stopRequestedBookIds = [...new Set([...(state.stopRequestedBookIds || []), ...runningBookIds])];
function isBookStopRequested(owner, bookId) {
  return stateFor(owner).stopRequestedBookIds.includes(String(bookId));
}
```

Queued/waiting-retry goes directly to `stopped`; running gets only a stop request. Clear the request after `stopped` or another terminal result.

- [ ] **Step 4: Check at every runner phase**

```js
if (shouldStop(bookId)) return stopBookAtStage(bookId, stage, task);
```

Check before classification, original fetch, sensitive processing, AI generation and 121 submission. Retain completed fields and skip later phases.

- [ ] **Step 5: Wire selected-stop and permanent-delete to queue cancellation**

```js
const queueResult = queue.cancelBooks(req.username, ids);
return res.json({ ...storedResult, ...queueResult });
```

Return `cancelled_queue_item_ids` and `stop_requested_book_ids`.

- [ ] **Step 6: Write stage-preservation test**

```js
test('stop after original fetch preserves source and skips AI and 121', async () => {
  const result = await executeBatchForTest({ shouldStop: () => originalWasSaved });
  assert.equal(result.tasks[0].status, 'stopped');
  assert.equal(result.tasks[0].original_status, 'done');
  assert.equal(submissions.length, 0);
});
```

- [ ] **Step 7: Run and commit**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/queue.test.js lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-retry-stage.test.js`

Expected: PASS; the maximum three-attempt retry policy remains unchanged.

```bash
git add lib/novel-fetch-workshop/queue.js lib/novel-fetch-workshop/v2-runtime.js lib/novel-fetch-workshop/runner.js lib/novel-fetch-workshop/v2-api-contract.js lib/novel-fetch-workshop/queue.test.js lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-retry-stage.test.js
git commit -m "fix(novel-fetch): stop books at safe queue stages"
```

### Task 3: 任务页队列中心和当前批次日志

**Files:**
- Modify: `lib/novel-fetch-workshop/task-ops.js:toV78Task`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js:buildRealtimeStatus,queueItemToProcessJob`
- Modify: `lib/novel-fetch-workshop/queue.js`, `lib/novel-fetch-workshop/runner.js`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js:mountTaskHistory,startSelectedProcessing,appendProcessLog`
- Test: `lib/novel-fetch-workshop/v2-api-contract.test.js`, `test/novel-fetch-batch-isolation.test.js`, `test/novel-fetch-progressive-queue.test.js`, `test/novel-fetch-performance.test.js`

**Interfaces:**
- Produces: `realtime/status.counts`; task fields `queue_status,queue_attempt,queue_max_attempts,queue_error,queued_text_model_id`; process progress records `{book_id,stage,status,message,at}`.

- [ ] **Step 1: Write the failing realtime-status test**

```js
test('realtime status exposes queue counts and model without credentials', () => {
  const output = buildRealtimeStatus({ items: [{ status: 'waiting_retry', attempt: 2, maxAttempts: 3, payload: { task_ids: ['book-1'], text_model_id: 'text-a' } }] }, []);
  assert.equal(output.counts.waiting_retry, 1);
  assert.equal(output.items[0].text_model_id, 'text-a');
  assert.equal(JSON.stringify(output).includes('credential'), false);
});
```

- [ ] **Step 2: Run it**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/v2-api-contract.test.js`

Expected: FAIL before normalized display items exist.

- [ ] **Step 3: Normalize queue items and merge them by book ID**

```js
function queueDisplayItem(item = {}) {
  return { status: String(item.status || 'queued'), attempt: Number(item.attempt || 0), max_attempts: Number(item.maxAttempts || 3), error: String(item.lastError || ''), task_ids: (item.payload?.task_ids || []).map(String), text_model_id: String(item.payload?.text_model_id || '') };
}
```

Pass display items into `taskOps.list()`; merge them in `toV78Task()` without leaking credentials or unrelated accounts.

- [ ] **Step 4: Persist bounded runner progress**

```js
item.progress = [...(item.progress || []), { book_id: String(progress.book_id), stage: String(progress.stage), status: String(progress.status), message: String(progress.message || ''), at: new Date().toISOString() }].slice(-120);
```

Emit classification, original fetch, sensitive, AI, 121, done, failed and stopped per requested book. Return only item-owned progress from `queueItemToProcessJob()`.

- [ ] **Step 5: Render three task scopes and current-job-only log**

Task page adds `当前批次`、`历史未完成`、`全部任务`, plus counts for executing, queued, retry waiting, failed and stopped. Rows show ID/书名、阶段、模型、retry count、processed/raw、AI、121 和错误。Processing page polls only its active job and de-duplicates progress via `at:book_id:stage:status`.

- [ ] **Step 6: Write isolated two-book test**

```js
test('process progress contains only the requested books in input order', async () => {
  const result = await runBatch(['2054404988995215768', '2084992034306373466']);
  assert.deepEqual(result.current_batch_ids, ['2054404988995215768', '2084992034306373466']);
  assert.deepEqual([...new Set(result.progress.map(x => x.book_id))], ['2054404988995215768', '2084992034306373466']);
});
```

- [ ] **Step 7: Run and commit**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-batch-isolation.test.js test/novel-fetch-progressive-queue.test.js test/novel-fetch-performance.test.js`

Expected: PASS; historical queue items never appear in a current two-book run.

```bash
git add lib/novel-fetch-workshop/queue.js lib/novel-fetch-workshop/runner.js lib/novel-fetch-workshop/task-ops.js lib/novel-fetch-workshop/v2-api-contract.js public/batch-rewrite/v78-novel-fetch-v2.js lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-batch-isolation.test.js test/novel-fetch-progressive-queue.test.js test/novel-fetch-performance.test.js
git commit -m "feat(novel-fetch): expose queue stages and batch progress"
```

### Task 4: 缓存、回归、精确 SHA 发布和受控验收

**Files:**
- Modify: `lib/novel-fetch-workshop/v2-page.js`
- Test: `lib/novel-fetch-workshop/v2-page.test.js` plus Task 1–3 tests

**Interfaces:**
- Produces: cache-busted V2 URL and public runtime associated with exact `v88` SHA.

- [ ] **Step 1: Write client-version test**

```js
test('V2 page serves the processing-flow client version', () => {
  assert.match(renderNovelFetchV2Page(), /v78-novel-fetch-v2\.js\?v=20260925-processing-flow-r1/);
});
```

- [ ] **Step 2: Run it**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/v2-page.test.js`

Expected: FAIL before asset version changes.

- [ ] **Step 3: Bump V2 asset query only**

```js
const V2_CLIENT_URL = '/batch-rewrite/v78-novel-fetch-v2.js?v=20260925-processing-flow-r1';
```

- [ ] **Step 4: Run focused regression suite**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test lib/novel-fetch-workshop/queue.test.js lib/novel-fetch-workshop/v2-api-contract.test.js test/novel-fetch-batch-isolation.test.js test/novel-fetch-progressive-queue.test.js test/novel-fetch-retry-stage.test.js test/novel-fetch-performance.test.js lib/novel-fetch-workshop/v2-page.test.js`

Expected: PASS. Isolate and record unrelated failures instead of claiming full-suite green.

- [ ] **Step 5: Commit, merge and publish exact v88 SHA**

```bash
git add lib/novel-fetch-workshop/v2-page.js lib/novel-fetch-workshop/v2-page.test.js
git commit -m "fix(novel-fetch): refresh processing workbench client"
git checkout v88
git merge --no-ff codex/v88-121-session-release
git push origin v88
git rev-parse v88
```

Verify `git merge-base --is-ancestor <feature-tip> v88`; deploy that resulting SHA by V88 Direct Deploy Node Stage then Cutover. Verify public build identity and authenticated Novel Fetch page. Do not deploy from the feature branch or alter Docker volumes.

- [ ] **Step 6: Run the user-selected model acceptance batch**

Select an enabled authenticated Processing-page model, then run:

```text
2054404988995215768 爸妈吞了我的赔偿款后
2084992034306373466 三颗还颜丹
```

Verify parsed rows, gender/style, processed/raw, only two current jobs, the retry ceiling, and 121 state only after real submission returns.

## Self-Review

- Coverage: Task 1 model selection/snapshot; Task 2 safe stop/delete; Task 3 queue center and isolated process logs; Task 4 cache, tests, exact-SHA release and the two-book acceptance run.
- Placeholder scan: every task specifies files, interfaces, assertion, command, expected state and commit boundary.
- Type consistency: `text_model_id` is request/batch/queue/display; `book_id` is progress; `stopRequestedBookIds` supports `isBookStopRequested`; `counts` belongs to realtime status.

