# V88 Novel Fetch Batch Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make novel-fetch batches date-safe, isolated to the submitted books, immediately visible, progressively updated, and explicit about scheduled auto-upload outcomes.

**Architecture:** Preserve the existing V2 queue and public UI, but make the batch record the source of truth for membership and input order. Persist a lightweight task row before expensive work, update task metadata per item/stage, and let date queries use batch-entry time rather than mutable `updatedAt`. Scheduled runs keep the existing background scheduler and `scheduled=true` auto-submit contract, adding visible intent/result labels.

**Tech Stack:** Node.js, Express route modules, JSON-backed per-user stores, existing V2 queue/scheduler, vanilla browser scripts, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-novel-fetch-batch-progress-design.md`

## Global Constraints

- Do not change the overall public UI layout.
- Do not modify `master`, V78 production branches, Go services, database tables, or online data volumes.
- Do not delete existing task data or overwrite original text, AI versions, upload receipts, or knowledge configuration.
- Scheduled processing defaults to automatic upload, but only succeeds when website submission is enabled and the 121 session is valid.
- Use bounded concurrency; never replace the current worker/session boundary with unbounded parallel browser/API work.

## Review Focus

- A batch that reuses three old Book IDs must still show exactly the eight submitted books in input order; test in Task 1.
- A completed task updated today but created in yesterday's batch must not appear in the strict “今天” view; test in Task 1.
- A queue item must be visible before classification/fetch finishes and must transition per book without waiting for the whole stage; test in Task 2.
- Pause/stop/retry must preserve completed work and not duplicate an existing queue item; test in Task 2.
- A scheduled run must auto-submit with a valid session and remain visibly pending/failed when the session or website submission is unavailable; test in Task 3.

---

### Task 1: Isolate batch membership and date filtering

**Files:**
- Modify: `lib/novel-fetch-workshop/batches.js`
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Modify: `lib/novel-fetch-workshop/task-ops.js`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js`
- Test: `test/novel-fetch-batch-isolation.test.js`
- Test: `test/novel-fetch-task-visibility.test.js`

**Interfaces:**
- `batches.create(owner, { taskIds, taskOrder, ... })` persists the exact submitted IDs and order.
- `batches.complete(owner, batchId, result)` updates only those IDs and retains the original membership.
- `taskOps.list(owner, query, { currentBatchIds, batchId })` filters by batch-entry date/current membership, not mutable update time.
- V2 task rows expose `batch_id`, `batch_created_at`, and `batch_order` when known; legacy rows continue to render.

- [ ] **Step 1: Write the failing regression tests**

  Add tests that create a batch with eight ordered IDs, complete it with an all-task result containing eleven rows, and assert that the batch still has eight IDs in the original order. Add date-filter fixtures where an old task has a newer `updatedAt` but an older `batchCreatedAt`, and assert strict today filtering excludes it while current-batch filtering includes only the submitted IDs.

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run `node --test test/novel-fetch-batch-isolation.test.js test/novel-fetch-task-visibility.test.js`.
  Expected: the new membership and strict-date assertions fail against the current all-task completion and `updatedAt`-first filtering.

- [ ] **Step 3: Add stable batch metadata and preserve membership**

  In `batches.create`, normalize and persist `taskIds` plus an ordered `taskOrder`. In `batches.complete`, intersect returned task states with the record’s original IDs and update only those states; never replace `record.taskIds` with the complete task-store listing. Add `batchId`, `batchCreatedAt`, and `batchOrder` to the task metadata defaults and pass them through `tasks.saveTasks`/`upsertIndexEntry` without changing existing text files.

- [ ] **Step 4: Make task queries batch/date aware**

  Update `taskTimestamp`/`filterTaskList` so an explicit `date` uses `batchCreatedAt` (falling back to `createdAt` for legacy rows), while the default current view uses the exact `currentBatchIds` and the strict today view does not append unfinished history. Sort current-batch results by `batchOrder`, then sort history by batch creation time and input order.

- [ ] **Step 5: Pass exact IDs/order from the V2 start route and render them**

  In `attachBatch`, pass `task_ids` as both membership and order. Ensure `GET /tasks` receives the current batch’s exact ID set. Update `renderCurrentBatch` to render the persisted ordered IDs even while `taskStates` is still empty, using “排队中” until a task state exists. Make the Today button send an explicit date query and keep history in its own view.

- [ ] **Step 6: Run the focused tests and commit**

  Run `node --test test/novel-fetch-batch-isolation.test.js test/novel-fetch-task-visibility.test.js` and then `git diff --check`.
  Expected: all focused tests pass.
  Commit with `git add lib/novel-fetch-workshop routes public/batch-rewrite test/novel-fetch-batch-isolation.test.js test/novel-fetch-task-visibility.test.js && git commit -m "fix: isolate novel fetch batches and dates"`.

### Task 2: Persist and report progressive queue work

**Files:**
- Modify: `lib/novel-fetch-workshop/runner.js`
- Modify: `lib/novel-fetch-workshop/v2-batch-executor.js`
- Modify: `lib/novel-fetch-workshop/queue.js`
- Modify: `lib/novel-fetch-workshop/v2-runtime.js`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js`
- Test: `test/novel-fetch-progressive-queue.test.js`
- Test: `test/novel-fetch-operation-timeout.test.js`

**Interfaces:**
- `runNovelFetchBatch` persists prepared task rows before classification and accepts a per-item `report` callback.
- Queue execution context exposes `shouldStop()` and `report(event)`; queue state records the active item and last stage without breaking existing status fields.
- The public current-batch panel can render queued IDs before `taskStates` is populated.

- [ ] **Step 1: Write the failing progressive tests**

  Add a runner test with delayed classification/fetch workers that asserts `saveTasks` occurs before the first delay, each completed book emits a report before the next book finishes, and a stopped run preserves completed task metadata. Add a queue test asserting `activeItemId`/`lastEvent` are visible while the worker is running.

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run `node --test test/novel-fetch-progressive-queue.test.js test/novel-fetch-operation-timeout.test.js`.
  Expected: the new early-persistence and per-item progress assertions fail because the runner saves after classification and the queue has no progress event bridge.

- [ ] **Step 3: Persist lightweight queued task metadata before expensive work**

  In `runNovelFetchBatch`, after parsing/preparing tasks and before classification, call `tasks.saveTasks` with `status: 'queued'`, the batch metadata, selected versions, and input order. Update each task to `classifying`, `original_processing`, `ai_processing`, `pending_upload`, or the corresponding failure/cancelled state before and after its worker call.

- [ ] **Step 4: Emit per-item reports and bridge them into queue state**

  Move fetch/rewrite reporting into the worker completion path so each book reports immediately. Extend queue execution control with `report(event)` that updates `activeItemId`, `currentStage`, and `lastEvent` atomically; pass it through `v2-runtime` and `v2-batch-executor` while retaining `shouldStop()` behavior.

- [ ] **Step 5: Use safe configured concurrency and refresh the UI progressively**

  Keep `runWithConcurrency` bounded by the configured fetch/AI limits, use the existing conservative default when absent, and ensure each worker update is persisted before the next queue poll. Update the V2 browser loop to refresh current batch/tasks on every queue-state or task-state change and show “排队中/处理中/已完成/失败” per book.

- [ ] **Step 6: Run the focused tests and commit**

  Run `node --test test/novel-fetch-progressive-queue.test.js test/novel-fetch-operation-timeout.test.js test/novel-fetch-retry-stage.test.js` and `git diff --check`.
  Expected: all pass, including existing stop/retry/timeout behavior.
  Commit with `git add lib/novel-fetch-workshop public/batch-rewrite test/novel-fetch-progressive-queue.test.js test/novel-fetch-operation-timeout.test.js && git commit -m "feat: show novel fetch progress per task"`.

### Task 3: Make scheduled upload intent and fallback visible

**Files:**
- Modify: `lib/novel-fetch-workshop/scheduler.js`
- Modify: `lib/novel-fetch-workshop/v2-runtime.js`
- Modify: `lib/novel-fetch-workshop/runner.js`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2-run-controls.js`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js`
- Test: `test/novel-fetch-scheduled-upload.test.js`

**Interfaces:**
- Scheduler records expose `autoSubmit: true` by default and preserve it through execution.
- Scheduled queue payloads include `scheduled: true` and `auto_submit` explicitly.
- UI labels distinguish “自动上传” from “待人工提交/失败待重试”.

- [ ] **Step 1: Write the failing schedule tests**

  Add one test where a due schedule invokes the queue with `{ scheduled: true, auto_submit: true }`, and the runner submits when the website is enabled/session is valid. Add a second test where session readiness is false and assert no false success is recorded; the task remains `pending_upload` or `failed` with a visible reason.

- [ ] **Step 2: Run the schedule tests and confirm failure**

  Run `node --test test/novel-fetch-scheduled-upload.test.js test/batch-factory-v11-scheduler.test.js`.
  Expected: the new explicit auto-submit/fallback assertions fail because schedule records do not expose the intent and the UI has no result label.

- [ ] **Step 3: Persist and propagate auto-submit intent**

  Add `autoSubmit: input.autoSubmit !== false` to scheduler records. When a due item starts, enqueue its input snapshot with `scheduled: true` and `auto_submit: item.autoSubmit !== false`. Keep the runner’s existing website-enabled/session checks and preserve pending/failed metadata and receipts.

- [ ] **Step 4: Render the schedule outcome and retry path**

  Update the schedule manager to show the configured upload mode and final outcome. On pending/failed completion, show the reason and link the user to the existing submit/retry controls; do not make the browser a required worker.

- [ ] **Step 5: Run the focused tests and commit**

  Run `node --test test/novel-fetch-scheduled-upload.test.js test/novel-fetch-upload-policy.test.js test/novel-fetch-retry-stage.test.js` and `git diff --check`.
  Expected: all pass.
  Commit with `git add lib/novel-fetch-workshop public/batch-rewrite test/novel-fetch-scheduled-upload.test.js && git commit -m "feat: expose scheduled novel fetch upload outcomes"`.

### Task 4: Integrated validation and release check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-novel-fetch-batch-progress-design.md` only if verification reveals a clarified contract.
- Test: existing `test/novel-fetch-*.test.js` and `tests/novel-fetch-*.test.js` suites.

- [ ] **Step 1: Run the complete novel-fetch test set**

  Run `node --test test/novel-fetch-*.test.js tests/novel-fetch-*.test.js`.
  Expected: all novel-fetch tests pass; unrelated repository baseline failures are recorded separately and do not block this feature review.

- [ ] **Step 2: Build the frontend bundle**

  Run `npm run frontend:build`.
  Expected: exit code 0; unresolved optional brand assets and chunk-size warnings may remain documented, but no build error is allowed.

- [ ] **Step 3: Inspect the running public UI contract locally**

  Verify the task panel shows strict Today, current batch count/order, queued-to-complete transitions, and schedule upload mode labels using the local built bundle. Do not perform a real 121 upload in this validation task.

- [ ] **Step 4: Review the final diff and status**

  Run `git diff --check`, `git status --short --branch`, and `git log --oneline -6`. Confirm no `master`/V78 branch changes, no credential files, and no user data deletion.

- [ ] **Step 5: Commit the release validation notes**

  If all feature tests and build pass, commit only any required test/fixture or documentation adjustment with `git commit -m "test: verify novel fetch batch progress flow"`; otherwise leave the failing evidence uncommitted and report the exact blocker.
