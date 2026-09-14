# Batch Factory Single-Book Stage Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Batch Factory novel independently refresh, generate copy/images/video, and retry only its last failed stage while preserving manual assets, prompts, and selected media versions.

**Architecture:** Add a durable book-stage ledger for `director`, `image`, and `video` runs. The Go service owns stage eligibility, skip/force semantics, retry selection, capability reasons, and ownership checks; React only renders that returned state and sends scoped commands. Existing Director revisions and production jobs remain the source of actual copy and VIDEO versions; generated asset images stay in the current book asset-image store.

**Tech Stack:** Go 1.22, MySQL 8 migration callbacks, Go `net/http`, React, Ant Design, Vite, Node test runner.

## Global Constraints

- A row represents exactly one book; no row command may affect another `bookId`.
- Normal generation is `mode=missing` and skips matching successful work; explicit modal re-generation is `mode=force` and adds a candidate version.
- Retry only uses the latest failed stage record owned by the current book; it never overwrites a successful stage.
- Manual asset prompts, manually created assets, visual-prompt overrides, video-prompt overrides, primary images, and primary media remain untouched unless the user explicitly selects the relevant replacement action.
- Image, text, and video submissions require the effective book configuration and real server-reported capability. Unavailable dependencies remain visible as unavailable; do not manufacture success data.
- Use centered modals/current-row actions only. Do not add drawers.
- Preserve the V11 hard rule `storyboard : VIDEO = 1 : 1`; a newly generated VIDEO is a candidate until the user chooses its primary version.
- 121 upload and batch merge behavior remain unchanged.

---

## File Structure

- `backend/internal/batchfactoryv11/stage_runs.go`: stage types, request modes, run summary and retry selection.
- `backend/internal/batchfactoryv11/stage_service.go`: book-scoped eligibility, normal/force execution and retry orchestration.
- `backend/internal/batchfactoryv11/stage_runs_mysql.go`: durable MySQL ledger implementation.
- `backend/internal/batchfactoryv11/memory_store.go`: in-memory ledger implementation for unit and HTTP tests.
- `backend/internal/storage/batch_factory_v11_schema.go`: additive migration `1100015` for stage runs.
- `backend/internal/httpapi/batch_factory_v11_stages.go`: scoped status, action, retry handlers.
- `backend/internal/httpapi/router.go`: wire stage-run routes when the Director service is available (Slice 2+).
- `backend/internal/batchfactoryv11/production.go`: accept `force` and optional `videoId` without replacing primary media.
- `backend/internal/httpapi/batch_factory_v11_production.go`: decode force/video scope.
- `frontend/src/shared/api/batchFactoryV11.js`: stage APIs and explicit force inputs.
- `frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.js`: pure row status, button availability and labels.
- `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`: row actions and scoped handler wiring.
- `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`: source-level UI and API contract assertions.
- `frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js`: pure action state tests.
- `frontend/src/user/pages/shuihuo-production.css`: compact per-book action presentation.

## Interfaces

```go
type BookStage string
const (
    BookStageDirector BookStage = "director"
    BookStageImage    BookStage = "image"
    BookStageVideo    BookStage = "video"
)
type StageMode string
const (
    StageModeMissing StageMode = "missing"
    StageModeForce   StageMode = "force"
)
type BookStageRun struct {
    ID, BatchID, BookID, RequestID, InputRevision, ErrorMessage string
    Stage BookStage
    Status ProductionState
    Attempt int
    CreatedAt, UpdatedAt time.Time
}
type BookStageSummary struct {
    BookID string
    Stages map[BookStage]BookStageRun
    LastFailed *BookStageRun
    Actions map[string]StageActionAvailability
}
type StageActionAvailability struct { Available bool; Reason string; SkipReason string }
```

```go
type BookStageService interface {
    GetBookStageSummary(ctx context.Context, owner, batchID, bookID string) (BookStageSummary, error)
    RunStage(ctx context.Context, owner, batchID, bookID string, stage BookStage, mode StageMode, videoID string) (BookStageRun, error)
    RetryLastFailed(ctx context.Context, owner, batchID, bookID string) (BookStageRun, error)
}
```

```js
getBookStageSummary(batchId, bookId)
runBookStage(batchId, bookId, { stage, mode, videoId })
retryBookStage(batchId, bookId)
```

### Task 1: Durable book-stage ledger and scoped summary

**Files:**
- Create: `backend/internal/batchfactoryv11/stage_runs.go`
- Create: `backend/internal/batchfactoryv11/stage_runs_mysql.go`
- Create: `backend/internal/batchfactoryv11/stage_runs_test.go`
- Modify: `backend/internal/batchfactoryv11/memory_store.go`
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Modify: `backend/internal/storage/batch_factory_v11_production_schema_test.go`

**Consumes:** Existing `ProductionState`, `Store`, `MySQLStore`, `MemoryStore`, ownership rules, and migration callback model.

**Produces:** `BookStageRunRepository` with create/update/list-by-book operations, `BookStageSummary`, and migration `1100015`.

- [x] **Step 1: Write stage-ledger tests**

```go
func TestBookStageSummaryReturnsOnlyLatestFailureForItsBook(t *testing.T) {
    store, batch := seedTwoBookBatch(t)
    failedA := mustCreateStageRun(t, store, "alice", batch.ID, batch.Books[0].ID, BookStageImage, ProductionFailed, 1)
    mustCreateStageRun(t, store, "alice", batch.ID, batch.Books[1].ID, BookStageVideo, ProductionFailed, 1)
    summary, err := NewBookStageService(store, nil, nil, nil).GetBookStageSummary(context.Background(), "alice", batch.ID, batch.Books[0].ID)
    if err != nil || summary.LastFailed == nil || summary.LastFailed.ID != failedA.ID { t.Fatalf("summary=%+v err=%v", summary, err) }
}
```

- [x] **Step 2: Run the focused test**

Run: `go test ./internal/batchfactoryv11 -run TestBookStageSummaryReturnsOnlyLatestFailureForItsBook -count=1`

Expected: FAIL because `BookStageService` and the stage ledger do not exist.

- [ ] **Step 3: Add types, repository methods, memory persistence, and migration**

```go
type BookStageRunRepository interface {
    CreateBookStageRun(context.Context, BookStageRun) (BookStageRun, error)
    UpdateBookStageRun(context.Context, string, string, BookStageRun) (BookStageRun, error)
    ListBookStageRuns(context.Context, string, string, string) ([]BookStageRun, error)
}
```

Add `batch_factory_v11_book_stage_runs` with owner, batch/book foreign keys, stage, request/input identifiers, status, attempt, error, timestamps, and an index on `(owner_username,batch_id,book_id,updated_at)`. Register only a new migration callback; do not edit an existing migration checksum.

- [ ] **Step 4: Run focused unit and migration tests**

Run: `go test ./internal/batchfactoryv11 ./internal/storage -run 'TestBookStage|TestV11ProductionMigration' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the ledger slice**

```bash
git add backend/internal/batchfactoryv11/stage_runs.go backend/internal/batchfactoryv11/stage_runs_mysql.go backend/internal/batchfactoryv11/stage_runs_test.go backend/internal/batchfactoryv11/memory_store.go backend/internal/batchfactoryv11/types.go backend/internal/storage/batch_factory_v11_schema.go backend/internal/storage/batch_factory_v11_production_schema_test.go
git commit -m "feat: persist batch book stage runs"
```

### Task 2: Server-owned missing/force/retry execution rules

**Files:**
- Create: `backend/internal/batchfactoryv11/stage_service.go`
- Create: `backend/internal/batchfactoryv11/stage_runs_service_test.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/production.go`
- Modify: `backend/internal/batchfactoryv11/production_test.go`

**Consumes:** Task 1 ledger, `DirectorService`, `ProductionService`, effective settings and book asset image records.

**Produces:** `RunStage` and `RetryLastFailed` implementations that call the existing Director/video services and return truthful unavailable reasons for the not-yet-configured image provider.

- [ ] **Step 1: Write failing orchestration tests**

```go
func TestRunDirectorMissingSkipsMatchingRevision(t *testing.T) {
    service, batch, book := seededStageService(t)
    first, err := service.RunStage(context.Background(), "alice", batch.ID, book.ID, BookStageDirector, StageModeMissing, "")
    if err != nil || first.Status != ProductionSucceeded { t.Fatal(first, err) }
    second, err := service.RunStage(context.Background(), "alice", batch.ID, book.ID, BookStageDirector, StageModeMissing, "")
    if err != nil || second.Attempt != first.Attempt || second.ID != first.ID { t.Fatalf("first=%+v second=%+v err=%v", first, second, err) }
}

func TestRetryLastFailedOnlyResubmitsNewestFailedStage(t *testing.T) {
    service, batch, book := seededStageService(t)
    mustFailStage(t, service, batch, book, BookStageImage)
    newest := mustFailStage(t, service, batch, book, BookStageVideo)
    retry, err := service.RetryLastFailed(context.Background(), "alice", batch.ID, book.ID)
    if err != nil || retry.Stage != BookStageVideo || retry.Attempt != newest.Attempt+1 { t.Fatalf("retry=%+v err=%v", retry, err) }
}
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `go test ./internal/batchfactoryv11 -run 'TestRunDirectorMissing|TestRetryLastFailed' -count=1`

Expected: FAIL because no book-stage orchestration exists.

- [ ] **Step 3: Implement the state machine**

`RunStage` must create a queued record, call only the requested service, and update success/failed with a bounded error. For `StageModeMissing`, compare the current text digest and effective config snapshot to the active Director revision; skip instead of creating a new revision when they match. For `StageModeForce`, always create a new Director revision or production job. Video force accepts a selected `videoId`; it creates a candidate task and never writes `primaryMediaTaskId`.

For image, resolve the book’s effective image model and assets module first. If there is no real configured image adapter, complete the stage as failed with the server-owned reason `图片生成服务未配置` and expose it to the row; do not create a `BookAssetImage` or pretend a candidate exists.

- [ ] **Step 4: Preserve normal VIDEO skip and explicit force behavior**

```go
func (s *ProductionService) SubmitBookProductionWithOptions(ctx context.Context, owner, batchID, bookID, requestID, provider string, options ProductionOptions) (ProductionJob, error) {
    // options.Force bypasses only the per-video completed/active block.
    // options.VideoID narrows to one owned VIDEO.
    // Never change primary-media selection here.
}
```

Keep `SubmitBookProductionWithProvider` as the compatibility wrapper using `ProductionOptions{}`.

- [ ] **Step 5: Run package tests**

Run: `go test ./internal/batchfactoryv11 -count=1`

Expected: PASS.

- [ ] **Step 6: Commit execution behavior**

```bash
git add backend/internal/batchfactoryv11/stage_service.go backend/internal/batchfactoryv11/stage_runs_service_test.go backend/internal/batchfactoryv11/director_service.go backend/internal/batchfactoryv11/production.go backend/internal/batchfactoryv11/production_test.go
git commit -m "feat: run and retry batch book stages"
```

### Task 3: Scoped HTTP contract and runtime capability response

**Files:**
- Create: `backend/internal/httpapi/batch_factory_v11_stages.go`
- Create: `backend/internal/httpapi/batch_factory_v11_stage_runs_test.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_director.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_production.go`
- Modify: `backend/internal/httpapi/router.go`

**Consumes:** Task 2 `BookStageService`, `ProductionOptions`, bridge authentication and `writeStoreError`.

**Produces:** authenticated book status/action/retry endpoints and force semantics for existing Director/production endpoints.

- [ ] **Step 1: Write failing signed-route tests**

```go
func TestBookStageRetryRejectsAnotherBooksFailure(t *testing.T) {
    api, now, batch, first, second := seededStageRouter(t)
    mustCreateFailedRun(t, batch.ID, second.ID, batchfactoryv11.BookStageVideo)
    rec := signedJSONRequest(t, api, now, "alice", http.MethodPost, stageBase(batch.ID, first.ID)+"/retry", map[string]any{})
    if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "no retryable failed stage") { t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String()) }
}
```

- [ ] **Step 2: Run the focused HTTP tests to verify failure**

Run: `go test ./internal/httpapi -run TestBookStage -count=1`

Expected: FAIL because stage routes are unregistered.

- [ ] **Step 3: Register the routes**

```text
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/stage-summary
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/stages
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/stages/retry
```

Decode `stage`, `mode`, and optional `videoId`; reject invalid stages/modes, use `bridgeOwner`, and return the service result. The route response contains action availability, skip reason, last failure, and no protected preset bodies.

- [ ] **Step 4: Run HTTP package tests**

Run: `go test ./internal/httpapi -run 'TestBookStage|TestBookAsset|TestBatchFactory' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the HTTP surface**

```bash
git add backend/internal/httpapi/batch_factory_v11_stages.go backend/internal/httpapi/batch_factory_v11_stage_runs_test.go backend/internal/httpapi/batch_factory_v11_director.go backend/internal/httpapi/batch_factory_v11_production.go backend/internal/httpapi/router.go
git commit -m "feat: expose batch book stage actions"
```

### Task 4: Row actions and modal re-generation controls

**Files:**
- Create: `frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.js`
- Create: `frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Consumes:** Task 3 API responses and existing `AssetEditor`, `PromptPanel`, `MediaVersionPanel` in `BatchFactoryNovelList.jsx`.

**Produces:** five book-scoped row buttons and explicit modal-level force/retry actions.

- [ ] **Step 1: Write failing pure UI action-state tests**

```js
test('row retry is enabled only for the current books latest failed stage', () => {
  const state = bookStageActions({ bookId: 'book-a', summary: { bookId: 'book-a', lastFailed: { stage: 'image' }, actions: { retry: { available: true } } } });
  assert.equal(state.retry.label, '重试图片');
  assert.equal(state.retry.disabled, false);
});

test('normal video generation skips completed work while force is available in the VIDEO panel', () => {
  const state = bookStageActions({ bookId: 'book-a', summary: completedVideoSummary() });
  assert.equal(state.video.disabled, true);
  assert.match(state.video.reason, /已有 VIDEO/);
  assert.equal(state.forceVideo.disabled, false);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add API client and pure action helper**

```js
export function getBookStageSummary(batchId, bookId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/stage-summary`));
}
export function runBookStage(batchId, bookId, input) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/stages`), { method: 'POST', body: body(input) });
}
export function retryBookStage(batchId, bookId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/stages/retry`), { method: 'POST', body: body({}) });
}
```

The helper must derive labels and disabled reasons exclusively from `summary.actions`; it cannot infer capability from a missing frontend model list.

- [ ] **Step 4: Render the row controls**

Replace the single `查看资料` operation surface with `刷新 / 生成文案 / 生成图片 / 生成视频 / 重试 / 查看资料`. Keep `查看资料`. Each event calls the new API with the row’s `book.id`, then refreshes that batch and the book’s stage summary. Show server messages for skips, queued work, failures, and missing dependencies.

- [ ] **Step 5: Add modal force/retry controls**

- In `AssetEditor`, add `重新生成资产` (`director`, `force` with asset-safe behavior) and `重试资产` (`retry` only when latest failed stage is image); keep item-level `生成图片` (`image`, `missing`) and `重生图` (`image`, `force`).
- In `PromptPanel`, add `重新生成文案` (`director`, `force`) and `重试文案` (only when the latest failure is director). Do not overwrite saved VIDEO prompt overrides.
- In `MediaVersionPanel`, add current-VIDEO `重新生成视频` (`video`, `force`, selected `videoId`) and `重试视频` (only a failed task for selected `videoId`). Do not select a new primary media version automatically.

All controls are in the existing centered modals and inherit their loading state.

- [ ] **Step 6: Run frontend tests and build**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js && npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 7: Commit the UI**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.js frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/user/pages/shuihuo-production.css
git commit -m "feat: add batch book stage controls"
```

### Task 5: Documentation and authenticated acceptance

**Files:**
- Modify: `docs/批量工厂V11-新版布局与生产逻辑-完整.md`
- Modify: `docs/superpowers/plans/2026-09-14-batch-factory-single-book-stage-actions.md`

**Consumes:** Tasks 1–4.

**Produces:** design material that records concrete behavior and a checked implementation plan.

- [ ] **Step 1: Record any provider capability boundary actually observed**

Add the exact configured/unconfigured result from the local runtime. Do not state that pictures were generated unless an authenticated provider request returned a persisted `BookAssetImage` and browser readback showed it.

- [ ] **Step 2: Run regression tests**

Run: `go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1 && node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/user/pages/shuihuo/batchFactoryBookStageActions.test.js && npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 3: Perform authenticated browser acceptance**

1. Open a batch with at least two books at `/shuihuo-production`.
2. Verify each row displays refresh, copy, image, video, retry, and view actions.
3. Trigger a book-level refresh and verify the other book’s row stays unchanged.
4. With unavailable image capability, verify `生成图片` explains the real reason and no fake image/version appears.
5. Open asset, prompt, and media modal; verify their force/retry controls are centered and scoped to the selected book/VIDEO.
6. Verify a completed VIDEO leaves `生成视频` skipped and `重新生成视频` creates only a candidate when the provider is available.

- [ ] **Step 4: Mark plan and commit documentation**

```bash
git add docs/批量工厂V11-新版布局与生产逻辑-完整.md docs/superpowers/plans/2026-09-14-batch-factory-single-book-stage-actions.md
git commit -m "docs: verify batch book stage actions"
```

## Self-Review

- Spec coverage: Task 1 gives durable per-book state; Task 2 gives missing/force/retry semantics; Task 3 makes that behavior authenticated and browser-readable; Task 4 gives row and modal controls; Task 5 validates all boundaries.
- Placeholder scan: no placeholder terms or deferred implementation markers are used.
- Type consistency: `BookStage`, `StageMode`, `BookStageRun`, `BookStageSummary`, and `BookStageService` are defined before routes and frontend client usage; the browser uses only the three route paths defined in Task 3.
