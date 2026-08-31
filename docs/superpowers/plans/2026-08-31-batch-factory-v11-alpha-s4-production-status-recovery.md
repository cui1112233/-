# Batch Factory V11 Alpha Slice 4: Production, Status, And Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real Go-owned single-Book and whole-Batch VIDEO submission, durable production status, failure/retry evidence, and refresh/restart recovery.

**Architecture:** Go accepts a production request only from a current Director revision and invokes the same `CompileFinalPrompt` function released in Slice 3. It persists an idempotent V11 job/task/media graph before and after provider calls. React reads Go aggregate status and never polls historical production endpoints or derives status from a client timer.

**Tech Stack:** Go 1.23, MySQL 8.4, Go queue/poller/object-storage adapters, configured video provider adapter, React 18, Node signed proxy.

## Global Constraints

- Slice 3 must be live and its final-prompt hash must be available.
- Go verifies model availability, frozen version, duration, required input, Director validity, and final-prompt hash before submission.
- Use one server-side Batch operation, not a browser loop of 100 generate requests.
- Provider submission has an explicit Go feature gate checked before credentials, DNS, or transport.
- Production requests are idempotent; retry creates an audited successor attempt, not a duplicate hidden provider task.
- Status and media truth are Go/MySQL records; Node does not aggregate or reinterpret them.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/production.go`, `production_store.go`, `status.go`, `recovery.go`, `production_adapter.go`.
- Create: `backend/internal/batchfactoryv11/production_test.go`, `status_test.go`, `recovery_test.go`.
- Create: `backend/internal/httpapi/batch_factory_v11_production.go`, `batch_factory_v11_status.go` and tests.
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`, `backend/internal/batchfactoryv11/capabilities.go`, `backend/internal/batchfactoryv11/final_prompt.go`.
- Create: `frontend/src/user/pages/batch-factory-v11/ProductionControls.jsx`, `ProductionStatusPanel.jsx`, `productionState.js`, `productionState.test.js`.
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `BatchFactoryV11Workbench.jsx`.

### Task 1: Persist idempotent V11 production jobs, tasks, events, and media links

**Files:**
- Create: `backend/internal/batchfactoryv11/production.go`, `production_store.go`, `status.go`, `production_test.go`, `status_test.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`

**Interfaces:**
- `SubmitBookProduction(ctx, ownerID, batchID, bookID, requestID string) (ProductionJob, error)`.
- `SubmitBatchProduction(ctx, ownerID, batchID, requestID string) (BatchProductionResult, error)`.
- `GetBatchStatus(ctx, ownerID, batchID string) (BatchStatus, error)`.
- Unique submission key: `(owner_id, operation, batch_id, book_id, video_id, director_revision_id, final_prompt_hash, request_id)`.

- [ ] **Step 1: Write failing idempotency and invalidation tests**

```go
func TestSubmitBookProductionUsesCompilerSnapshot(t *testing.T) {
    job := submitBook(t, validBook(t))
    assert.Equal(t, compileForBook(t, job.BookID).SnapshotHash, job.FinalPromptHash)
}

func TestSubmitProductionRejectsInvalidatedDirector(t *testing.T) {
    invalidateDirector(t, validBook(t))
    err := submitBookExpectError(t, validBook(t))
    assert.ErrorContains(t, err, "invalidated")
}

func TestRepeatedRequestIDReturnsSameProductionJob(t *testing.T) {
    first := submitBookWithRequestID(t, "r-1")
    second := submitBookWithRequestID(t, "r-1")
    assert.Equal(t, first.ID, second.ID)
}
```

- [ ] **Step 2: Run tests and confirm V11 production package is absent**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestSubmitBookProductionUsesCompilerSnapshot|TestSubmitProductionRejectsInvalidatedDirector|TestRepeatedRequestIDReturnsSameProductionJob' -count=1`

Expected: FAIL with missing production service.

- [ ] **Step 3: Implement transactional job/task/media schema and service**

Create V11 production job, task, task event, and media-link tables. Persist the
serialized final provider-neutral payload and snapshot hash before calling the
adapter. A Batch submission resolves eligible Books on the server and writes a
result row for each Book; partial failures are explicit results, not a rolled-up
success. Reject a missing/changed compiler snapshot and an invalidated revision.

- [ ] **Step 4: Run domain tests with a deterministic adapter**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'Test.*Production|Test.*Status|Test.*Idempot' -count=1`

Expected: PASS; no test calls an external provider and duplicate submissions
produce one persistent job.

- [ ] **Step 5: Commit production persistence**

```bash
git add backend/internal/batchfactoryv11 backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): persist idempotent production jobs"
```

### Task 2: Implement Go provider submission, polling, status, and restart recovery

**Files:**
- Create: `backend/internal/batchfactoryv11/production_adapter.go`, `recovery.go`, `recovery_test.go`
- Create: `backend/internal/httpapi/batch_factory_v11_production.go`, `batch_factory_v11_status.go` and tests
- Modify: `backend/internal/httpapi/router.go`, `backend/internal/batchfactoryv11/capabilities.go`

**Interfaces:**
- Adapter: `Submit(ctx, FrozenVideoModel, FinalPrompt) (ProviderTaskRef, error)` and `Poll(ctx, ProviderTaskRef) (ProviderTaskState, error)`.
- Recovery: `RecoverActiveProduction(ctx) error` resumes durable queued/running jobs after service restart.
- HTTP: `POST /batches/{batchId}/books/{bookId}/production`, `POST /batches/{batchId}/production`, `GET /batches/{batchId}/status`.

- [ ] **Step 1: Write failing gate and restart tests**

```go
func TestProductionGateBlocksBeforeAdapterLookup(t *testing.T) {
    adapter := &countingAdapter{}
    service := newProductionService(adapter, FeatureGate{Production: false})
    assert.ErrorContains(t, service.SubmitBookProduction(ctx, ownerID, batchID, bookID, "r"), "not enabled")
    assert.Zero(t, adapter.SubmitCalls)
}

func TestRecoveryResumesOnlyDurableActiveJobs(t *testing.T) {
    seedActiveAndTerminalJobs(t)
    require.NoError(t, service.RecoverActiveProduction(ctx))
    assert.Equal(t, 1, adapter.PollCalls)
}
```

- [ ] **Step 2: Run tests and confirm failure before adapter/recovery implementation**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestProductionGateBlocksBeforeAdapterLookup|TestRecoveryResumesOnlyDurableActiveJobs' -count=1`

Expected: FAIL with missing adapter/recovery symbols.

- [ ] **Step 3: Implement feature-gated adapter orchestration and poller recovery**

Check the production gate before resolving any credential reference, endpoint,
DNS, queue, or adapter. Write a task event for each state transition. Persist
provider task references, error code/message, attempt number, media link, and
retry lineage. Start recovery from `main.go` after migrations and use only
durable queued/running jobs; no browser session participates in recovery.

- [ ] **Step 4: Run Go handler and recovery suites**

Run:

```bash
cd backend
go test ./internal/batchfactoryv11 -run 'Test.*Production|Test.*Recovery|Test.*Poll' -count=1
go test ./internal/httpapi -run 'Test.*V11Production|Test.*V11Status' -count=1
```

Expected: PASS; gate prevents adapter invocation, status is owner-scoped, and
restart recovery has no duplicate submission.

- [ ] **Step 5: Commit Go production/status implementation**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi backend/cmd/qiantie
git commit -m "feat(batch-v11): run and recover production jobs in Go"
```

### Task 3: Connect production controls and durable status UI

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/ProductionControls.jsx`, `ProductionStatusPanel.jsx`, `productionState.js`, `productionState.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`

**Interfaces:**
- `submitBookProduction(batchId, bookId, requestId)` and `submitBatchProduction(batchId, requestId)` send an idempotency key.
- `loadBatchStatus(batchId)` returns Go-aggregated Book/VIDEO/job/media state.
- Polling occurs only while Go reports active jobs; it stops when all are terminal.

- [ ] **Step 1: Write failing UI-state tests**

```js
test('active status enables polling and terminal status stops it', () => {
  assert.equal(shouldPoll([{ status: 'running' }]), true);
  assert.equal(shouldPoll([{ status: 'succeeded' }, { status: 'failed' }]), false);
});

test('retry uses a new request ID and retains prior task link', () => {
  assert.notEqual(retryRequest('job-1').requestId, 'job-1');
});
```

- [ ] **Step 2: Run state tests and confirm missing UI helpers**

Run: `node --test frontend/src/user/pages/batch-factory-v11/productionState.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement controls using Go capability/state responses**

Render single-Book and whole-Batch production actions only when
`production.submit` is available. Show per-VIDEO state, partial failure,
provider-independent error text, retry lineage, and media links from Go. Use a
stable request ID per click and disable duplicate click while the request is
in flight. Do not call legacy `shuihuo-production/batch-factory` endpoints.

- [ ] **Step 4: Run tests, build, and isolated restart acceptance**

Run: `node --test frontend/src/user/pages/batch-factory-v11/productionState.test.js && npm --prefix frontend run build`

Acceptance: submit one Book with the deterministic adapter; submit a Batch
with one intentional failure; refresh; restart Go/web; confirm task state,
error, retry lineage, and media remain accurate. Then verify disabled provider
gate produces no provider call.

- [ ] **Step 5: Commit production UI**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11): show durable production status"
```

### Task 4: Release Slice 4 to :3000 Alpha and stop

- [ ] **Step 1: Run all Go tests, Node proxy/UI-state tests, frontend build, and fresh migration checks**

Expected: PASS.

- [ ] **Step 2: Release immutable images with backup and manifest**

Use the Alpha script. Record the production feature-gate value, test-adapter
result, new image digests, prior images, and V11 schema backup ID.

- [ ] **Step 3: Verify live Alpha behavior**

Confirm compiler preview hash matches the persisted production job hash, a
single Book can submit, whole-Batch submission is server-side, refresh/restart
recovery works, and Merge/121/Yadi remain unavailable.

- [ ] **Step 4: Commit release evidence and stop**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice four release"
```
