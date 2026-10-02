# Batch Factory Automatic Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Giant OCR and automatic production survive browser closure, cap automatic failures by stage, and remove high-fanout status polling.

**Architecture:** The persistent automation controller owns Giant OCR handoff and retry admission. It persists a per-book/per-stage retry ledger and asks an injected adapter to reconcile executor results. The UI reads one server-owned batch runtime summary instead of polling each book separately.

**Tech Stack:** Node.js, `node:test`, React/Ant Design, existing Go giant-executor API, MySQL-backed batch records.

## Global Constraints

- Work on `codex/batch-automation-recovery`, then merge to `v88`; never edit ECS as source.
- Do not resend a confirmed upload or recreate a succeeded stage.
- Hard errors (`invalid input`, invalid JSON, token/configuration/authentication) receive zero automatic retry.
- Transient errors receive no more than three total automatic attempts for one input revision and stage.
- OCR handoff cannot require React to be mounted.
- Release is Git-first direct incremental deployment; do not use GitHub Actions.

---

### Task 1: Persistent retry budget and fair scheduler

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Test: `lib/batch-factory-v11/automation-orchestrator.test.js`

**Interfaces:** `retryLedger["<inputRevision>:<stage>"] = { attempts, terminal, lastError }` is persisted per automation book.

- [ ] Write failing tests for a transient stage failing exactly three times, a hard JSON error failing once, and a second ready book starting after the first terminal failure.
- [ ] Run `node --test lib/batch-factory-v11/automation-orchestrator.test.js` and confirm those tests fail because retry ledger behavior is absent.
- [ ] Add `stageRetryKey(book, stage, revision)` and ledger helpers. Increment before submission; terminalize at three for transient errors; do not reset ledger from resume. Explicit single-book retry clears only its selected ledger entry.
- [ ] Re-run the focused tests and commit `fix(batch): bound automatic stage retries`.

### Task 2: Server-owned Giant OCR reconciliation

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `routes/batch-factory-v11.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.jsx`
- Test: `lib/batch-factory-v11/automation-orchestrator.test.js`
- Test: the existing server route/adapter contract test

**Interfaces:** Adapter gains `reconcileGiantSource({ owner, isOwner, batch, book, job })`, returning `{ state: 'waiting'|'ready'|'failed', book?, message?, error? }`.

- [ ] Write failing controller tests proving an OCR-success result is persisted and advances without a browser, and an OCR failure becomes terminal without consuming an automatic slot.
- [ ] Run focused tests and verify the expected failure.
- [ ] Call reconciliation at the controller source boundary. Success atomically writes source text and clears `contentPending`; OCR failure records terminal source failure; queued/running remains lightweight waiting.
- [ ] Reduce React to progress display plus explicit manual recovery; it must not persist OCR results or start automation.
- [ ] Re-run Node/route tests and commit `fix(batch): reconcile giant OCR on server`.

### Task 3: Batch runtime summary and task-log polling

**Files:**
- Modify: `routes/batch-factory-v12.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Test: route contract test
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:** `GET /api/batch-factory/v12/batches/:batchId/runtime-summary` returns `{ automation, giantSources, production, merges, stageSummaries }`; `getBatchRuntimeSummary(batchId)` is its client.

- [ ] Write failing contract/source tests requiring one summary call and forbidding the `Promise.allSettled(books.map(getBookStageSummary))` fanout in `loadRuntimeStatus`.
- [ ] Run tests and verify failure.
- [ ] Implement the server summary with latest per-book stage information and retry budget, preserving existing individual endpoints.
- [ ] Replace UI fanout with the summary call, deduplicate in-flight refreshes, and display `自动重试 x/3` or `已停止并让位` with exact reason.
- [ ] Run focused tests and `npm run frontend:build`; commit `fix(batch): aggregate runtime status polling`.

### Task 4: Verification and release

- [ ] Run `node --test lib/batch-factory-v11/automation-orchestrator.test.js test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialFlow.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`.
- [ ] Run `npm run frontend:build` and `cd backend && go test ./internal/giantmaterialexecutor/... ./internal/storage/...`.
- [ ] Inspect generated distribution changes; retain only tracked outputs produced by the build.
- [ ] Commit the verified candidate, merge it into `v88`, push the exact SHA, and deploy through the approved Git-direct incremental ECS path.
- [ ] Verify external build SHA, an authenticated runtime-summary response, and a read-only production batch status request.
