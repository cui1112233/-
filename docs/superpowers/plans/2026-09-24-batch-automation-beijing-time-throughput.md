# 批量工厂北京时间调度与十本队列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Batch Factory scheduling explicitly use China Standard Time, add a true immediate-automation entry, and run ten books through a durable, throttled per-book queue.

**Architecture:** A small client-side schedule codec converts `datetime-local` values between `Asia/Shanghai` wall-clock time and persisted ISO instants. The Node automation controller freezes a per-job book-concurrency value, admits only eligible books, and keeps transient per-book failures in a persisted retry state while hard failures remain visible and do not block other books.

**Tech Stack:** React, Ant Design, Node.js `node:test`, existing Batch Factory V11 API and JSON automation state.

## Global Constraints

- User-visible scheduling language is `北京时间（UTC+8）`; a scheduled time starts production, never direct submission.
- Preserve `full_submit`: upload happens only after merged media and video-management confirmation.
- Use only 1, 2, or 4 simultaneous books; default to 2 and cap at 4.
- Existing books, prompts, media, receipts, presets, and manual flows remain intact.
- All changes land in Git `v88` before public deployment.

---

### Task 1: Beijing time codec and creation payload

**Files:**
- Create: `frontend/src/user/pages/shuihuo/batchFactoryAutomationSchedule.js`
- Create: `frontend/src/user/pages/shuihuo/batchFactoryAutomationSchedule.test.js`
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryManualFetch.js`
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`

**Interfaces:**
- Produces `parseBeijingDatetimeLocal(value): string` and `formatBeijingDatetimeLocal(iso): string`.
- `buildManualBatchSubmission` receives `automationEnabled`, `scheduledAt`, `runMode`, and `automationConcurrency` and preserves an immediate job when automation is enabled with an empty `scheduledAt`.

- [ ] **Step 1: Write failing codec and payload tests**

```js
assert.equal(parseBeijingDatetimeLocal('2026-09-25T03:00'), '2026-09-24T19:00:00.000Z');
assert.equal(formatBeijingDatetimeLocal('2026-09-24T19:00:00.000Z'), '2026-09-25T03:00');
assert.equal(payload.automationEnabled, true);
assert.equal(payload.scheduledAt, '');
assert.equal(payload.automationConcurrency, 4);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryAutomationSchedule.test.js frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`

- [ ] **Step 3: Implement the codec and payload normalization**

```js
export function parseBeijingDatetimeLocal(value) {
  const matched = String(value).match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/);
  if (!matched) return '';
  const [, y, m, d, h, minute] = matched;
  return new Date(Date.UTC(y, Number(m) - 1, d, Number(h) - 8, minute)).toISOString();
}
```

- [ ] **Step 4: Add explicit creation actions**

Use `立即执行` to call `submit({ automationRun: true })`; use `开始定时` to require a Beijing date and call `submit({ scheduledRun: true })`. Both display the selected preset, run mode and 1/2/4 book concurrency before creating the batch.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryAutomationSchedule.test.js frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`

### Task 2: Per-job concurrency and durable retries

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `test/batch-factory-automation.test.js`

**Interfaces:**
- `start({ concurrency })` returns and persists `concurrency` as 1, 2, or 4.
- Every public book state may expose `retryAt` and `retryCount`.
- A runnable book is pending/running, or a retry-waiting book whose `retryAt <= now`.

- [ ] **Step 1: Write failing automation tests**

```js
const status = await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 4 });
assert.equal(status.concurrency, 4);
assert.equal(maxActiveBooks, 4);
assert.equal(status.books.find(book => book.bookId === 'book-1').retryAt, '1970-01-01T00:00:30.000Z');
```

The ten-book fixture uses delayed stage execution and asserts no more than the frozen concurrency runs. A temporary provider failure waits for retry while a second book reaches its next stage. An `Invalid API key` failure remains terminal and is not automatically retried.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/batch-factory-automation.test.js`

- [ ] **Step 3: Freeze and honor concurrency per job**

Normalize incoming concurrency through the existing 1–4 clamp and permitted values; preserve 2 for old jobs. Replace the controller-wide candidate slice with each job’s frozen concurrency and skip retry-waiting books until eligible.

- [ ] **Step 4: Persist retry state**

Classify authentication, authorization, invalid-input and missing-configuration errors as terminal. For transient stage errors, persist bounded retry counts and increasing delays; do not consume a book slot before its retry time. Maintain existing manual retry as an immediate user override.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/batch-factory-automation.test.js`

### Task 3: Existing-workbench controls and observability

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Both create and existing-batch controls send normalized `scheduledAt` and `concurrency` to `startBatchAutomation`.
- Existing workbench exposes explicit `立即执行` and `开始定时` actions.

- [ ] **Step 1: Write failing source behavior tests**

```js
assert.match(source, /北京时间（UTC\+8）/);
assert.match(source, /立即执行/);
assert.match(source, /同时处理书籍/);
assert.match(source, /下次重试/);
```

- [ ] **Step 2: Run source test and verify RED**

Run: `node --test --test-name-pattern='Beijing|immediate|concurrency|retry' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

- [ ] **Step 3: Implement explicit controls and status copy**

Use one settings modal with separate footer actions. `立即执行` sends no `scheduledAt`; `保存定时任务` requires a valid future Beijing wall-clock value. Render current concurrent limit and retry time per book when present. Pass creation concurrency through `ShuihuoProductionPage` unchanged.

- [ ] **Step 4: Run focused source test and commit**

Run: `node --test --test-name-pattern='Beijing|immediate|concurrency|retry' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

### Task 4: Full verification and V88 release

**Files:**
- Modify only files produced by Tasks 1–3.

- [ ] **Step 1: Run regression suite and build**

Run:

```bash
node --test test/batch-factory-automation.test.js \
  frontend/src/user/pages/shuihuo/batchFactoryAutomationSchedule.test.js \
  frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js
npm --prefix frontend run build
git diff --check
```

- [ ] **Step 2: Inspect the final diff and commit**

Run: `git status --short && git diff --check`

- [ ] **Step 3: Merge into v88 and publish exact SHA**

Verify `git merge-base --is-ancestor <sha> origin/v88`, build only from the merged SHA, then verify public `/api/build-info` returns that SHA.

- [ ] **Step 4: Live acceptance**

Create a future Beijing-time test batch, verify it remains `scheduled`, then verify it records `startedAt` after the chosen time. Do not claim whole-flow provider success until media and video-management confirmation are separately observed.
