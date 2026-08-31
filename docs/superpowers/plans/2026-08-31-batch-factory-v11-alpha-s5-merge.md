# Batch Factory V11 Alpha Slice 5: Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Go-owned merge capability, validated request, durable job/status, output-media persistence, retry, and preview for completed V11 Book VIDEO assets.

**Architecture:** Go freezes ordered V11 input-media IDs and merge settings into an immutable Merge Job before invoking FFmpeg/object storage. It owns capability detection, execution, status, and result. React asks Go whether merge is ready and never runs or simulates FFmpeg in Node or the browser.

**Tech Stack:** Go 1.23, MySQL 8.4, FFmpeg, V11 object storage/media adapter, React 18.

## Global Constraints

- Slice 4 must be released with durable V11 media links.
- Merge accepts only completed V11 VIDEO media belonging to the requested Book and owner.
- Duplicate requests return the existing active/succeeded Merge Job when the immutable input snapshot matches.
- A new retry preserves the old job/event audit and creates an explicit successor.
- Capability reports dependency readiness without invoking a provider or modifying state.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/merge.go`, `merge_store.go`, `merge_executor.go`, `merge_test.go`, `merge_store_test.go`.
- Create: `backend/internal/httpapi/batch_factory_v11_merge.go`, `batch_factory_v11_merge_test.go`.
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`, `backend/internal/batchfactoryv11/capabilities.go`, `status.go`.
- Create: `frontend/src/user/pages/batch-factory-v11/MergePanel.jsx`, `MergeResultPreview.jsx`, `mergeState.js`, `mergeState.test.js`.
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `BatchFactoryV11Workbench.jsx`.

### Task 1: Persist immutable Merge Jobs and validate input capability

**Files:**
- Create: `backend/internal/batchfactoryv11/merge.go`, `merge_store.go`, `merge_test.go`, `merge_store_test.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`

**Interfaces:**
- `GetMergeCapability(ctx) MergeCapability` returns `{Ready, Reasons, FFmpegVersion, StorageReady}` without mutations.
- `RequestMerge(ctx, ownerID, batchID, bookID string, request MergeRequest) (MergeJob, error)`.
- `MergeRequest` contains only speed strategy and a client request ID; server chooses ordered completed V11 media.

- [ ] **Step 1: Write failing validation/idempotency tests**

```go
func TestMergeRejectsIncompleteOrForeignMedia(t *testing.T) {
    err := requestMergeExpectError(t, bookWithIncompleteOrForeignMedia(t))
    assert.ErrorContains(t, err, "completed")
}

func TestSameMergeSnapshotReturnsExistingJob(t *testing.T) {
    first := requestMerge(t, completeBook(t), "r1")
    second := requestMerge(t, completeBook(t), "r2")
    assert.Equal(t, first.ID, second.ID)
}
```

- [ ] **Step 2: Run tests and confirm merge service is missing**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestMergeRejectsIncompleteOrForeignMedia|TestSameMergeSnapshotReturnsExistingJob' -count=1`

Expected: FAIL with missing merge symbols.

- [ ] **Step 3: Implement merge tables and snapshot validation**

Create `batch_factory_v11_merge_jobs`, `batch_factory_v11_merge_inputs`, and
`batch_factory_v11_merge_events`. Persist ordered input media, source durations,
speed strategy, executor version, and output-media link. Allow only supported
speeds `1.0` through `2.0`; reject duplicate/foreign/nonterminal inputs.

- [ ] **Step 4: Run merge domain suite**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'Test.*Merge' -count=1`

Expected: PASS; capability calls do not create a job and matching input
snapshots are idempotent.

- [ ] **Step 5: Commit merge persistence**

```bash
git add backend/internal/batchfactoryv11 backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): persist validated merge jobs"
```

### Task 2: Execute merge in Go and expose capability/request/status routes

**Files:**
- Create: `backend/internal/batchfactoryv11/merge_executor.go`, `backend/internal/httpapi/batch_factory_v11_merge.go`
- Test: `backend/internal/httpapi/batch_factory_v11_merge_test.go`, `backend/internal/batchfactoryv11/merge_executor_test.go`
- Modify: `backend/internal/httpapi/router.go`, `backend/internal/batchfactoryv11/capabilities.go`

**Interfaces:**
- Executor: `Run(ctx, MergeInputSnapshot) (MergedMedia, error)`.
- HTTP: `GET /merge-capability`, `POST /books/{bookId}/merge`, `GET /books/{bookId}/merge`.

- [ ] **Step 1: Write failing executor/route tests**

```go
func TestMergeCapabilityReportsMissingFFmpegWithoutExecuting(t *testing.T) {
    got := service.Capability(ctx)
    assert.False(t, got.Ready)
    assert.Contains(t, got.Reasons, "FFmpeg")
    assert.Zero(t, executor.Calls)
}

func TestMergeRetryCreatesAuditedSuccessor(t *testing.T) {
    failed := seedFailedMerge(t)
    retried := retryMerge(t, failed.ID)
    assert.Equal(t, failed.ID, retried.PreviousJobID)
}
```

- [ ] **Step 2: Run focused tests and confirm missing executor/routes**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'TestMergeCapabilityReportsMissingFFmpegWithoutExecuting|TestMergeRetryCreatesAuditedSuccessor' -count=1`

Expected: FAIL with missing symbols/routes.

- [ ] **Step 3: Implement bounded Go executor and status updates**

Resolve FFmpeg and storage in Go, create a restricted temporary directory,
limit total input size, write the concat manifest from immutable IDs, run
FFmpeg with a timeout, upload output through the V11 storage adapter, then
persist media and events. Clean temporary files regardless of outcome. Store
bounded error data and leave original VIDEO media untouched.

- [ ] **Step 4: Run Go merge suite**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'Test.*Merge' -count=1`

Expected: PASS with fake FFmpeg/storage; dependency-missing and execution
failure states persist deterministically.

- [ ] **Step 5: Commit Go Merge API**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi
git commit -m "feat(batch-v11): execute and report merges in Go"
```

### Task 3: Add Merge UI and output preview

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/MergePanel.jsx`, `MergeResultPreview.jsx`, `mergeState.js`, `mergeState.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`

**Interfaces:**
- `loadMergeCapability()`, `requestMerge(batchId, bookId, requestId, speed)`, `loadMergeStatus(batchId, bookId)`.
- UI gets media preview/download URL only from Go status response.

- [ ] **Step 1: Write failing UI-state tests**

```js
test('merge action is disabled when capability is not ready', () => {
  assert.equal(mergeActionState({ ready: false, reasons: ['FFmpeg'] }).disabled, true);
});

test('merge success renders server output media link', () => {
  assert.equal(mergeResult({ status: 'succeeded', media: { downloadPath: '/media/7' } }).href, '/media/7');
});
```

- [ ] **Step 2: Run state tests and confirm missing merge UI modules**

Run: `node --test frontend/src/user/pages/batch-factory-v11/mergeState.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement capability/state-driven Merge panel**

Show exact Go capability reasons, supported speed, job status/event history,
retry action, source/estimated output duration, and output preview. Do not show
a clickable merge action when Go reports missing dependencies or incomplete
VIDEO state.

- [ ] **Step 4: Run tests, build, and merge acceptance**

Run: `node --test frontend/src/user/pages/batch-factory-v11/mergeState.test.js && npm --prefix frontend run build`

Acceptance: use deterministic media; submit a merge; refresh/restart; verify
status/output; fail a merge; retry; verify old/new job audit; check original
VIDEO assets remain available.

- [ ] **Step 5: Commit Merge UI**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11): add merge controls and result preview"
```

### Task 4: Release Slice 5 and stop

- [ ] **Step 1: Run full tests/build, plus FFmpeg/object-storage test adapter checks**

Expected: PASS.

- [ ] **Step 2: Release immutable images with backup/manifest via the Alpha script**

Record capability status and exact FFmpeg dependency result in the manifest.

- [ ] **Step 3: Verify live :3000 Merge flow with non-production test media first**

Confirm Go owns capability/request/status/persistence, then record user-facing
result and rollback path. 121/Yadi remain unavailable.

- [ ] **Step 4: Commit release evidence and stop**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice five release"
```
