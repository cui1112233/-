# Batch Factory V11 Phase 4 Production, Status And Merge Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax and every task produces a separately testable commit.

**Goal:** 由 Go/MySQL 持久化 V11 单 VIDEO 与整批生产提交、状态查询、容器重启恢复和每本小说的合并产物；所有生产请求只能使用 Phase 3 的 frozen Final Prompt，不允许 Node 或浏览器重新拼接 Prompt。

**Architecture:** Production service 事务性创建请求与 idempotency record，后台 worker 从 MySQL 领取任务并调用 Go provider adapter，随后以 provider job ID 轮询并持久化状态/媒体引用。Merge service 仅处理同一 owner、同一 Book、全部成功且顺序明确的 V11 VIDEO 产物，并记录 immutable input manifest 和输出对象。Node 继续透明 HMAC proxy；不导入旧 Node production bridge、旧项目 media route 或旧合并实现。

**Tech Stack:** Go 1.23、database/sql、MySQL 8.4、Go context worker、FFmpeg、V11 object-store interface、net/http、Node 24/Express 5 proxy、React V11 client。

## Global Constraints

- 前置输入是 Phase 3 审核通过的 Go Director/Compiler SHA。`CompileFinalPrompt` 是唯一允许构造生产 payload 的函数；生产服务不得接受浏览器传来的最终 Prompt、模型最大时长、provider endpoint 或 credential。
- 历史 `origin/10-batch-factory-go-api-migration@b02632d77d299f3106483b6b37621019cd9ca1dc` 的 production/merge handler 仅用于核对行为：FFmpeg capability、输入排序、大小/超时限制、输出原子性和旧成品不被提前删除。不得恢复 `backend/internal/shuihuo/*` 或其 Node 调用链。
- 新 schema 只新增 Migration `1100006`；不得修改 Migration `1100001` 到 `1100005`。Phase 1 导入审计固定使用 `1100007`。
- 所有任务、状态、provider job ID、重试、媒体引用、合并 manifest 和审计由 Go/MySQL 负责。Node 不保存 V11 job、轮询状态、provider request 或 merge state，不与 Go dual-write。
- `production.submit` 是唯一生产 capability 名称。`production.run` 不能出现在 Go API、Node proxy、React capability checks 或 persisted records 中。
- 服务端配置 `QIANTIE_BATCH_FACTORY_V11_MAX_CONCURRENCY` 必须是 1 到 8 的整数，默认 1。浏览器不传并发数，也不能通过批量提交绕过上限。
- 外部执行要求三层同时成立：Go feature gate 开启、Go credential/model configuration 可用、候选环境没有 egress block。候选环境必须使第一项为 false、没有生产凭据且网络为 internal；因此提交返回明确的 disabled response，不发送外部请求。
- 121/Yadi 不属于本阶段。`publish.121` 和 `publish.yadi` 保持 false，且不得建立隐式上传/发布副作用。
- 不接触 `:3000`、正式 MySQL、正式 volume、生产 provider、生产 object bucket 或 `master`。所有 media test fixture 使用临时目录或 candidate object volume。

## File Structure

- Create: `backend/internal/storage/batch_factory_v11_production_schema.go` and `batch_factory_v11_production_schema_test.go` for Migration `1100006`.
- Create: `backend/internal/batchfactoryv11/production_types.go`, `production_store.go`, `production_service.go`, `production_worker.go`, `production_provider.go`, `object_store.go`, `merge_service.go`, and focused tests.
- Modify: `backend/internal/batchfactoryv11/types.go`, `memory_store.go`, `mysql_store.go`, `final_prompt.go`, `backend/internal/app/app.go`, `backend/internal/config/config.go`, `backend/internal/httpapi/router.go`, and `batch_factory_v11_capabilities.go`.
- Create: `backend/internal/httpapi/batch_factory_v11_production_test.go` and `batch_factory_v11_merge_test.go`.
- Modify later, only after Go contract tests pass: `frontend/src/shared/api/batchFactoryV11.js`, `BatchFactoryV11Workbench.jsx`, and related UI tests in the Phase 5 worktree.

### Task 1: Add persistent production request, status, and audit models

**Interfaces:**

- `ProductionStatus` has exactly `queued`, `submitting`, `submitted`, `running`, `succeeded`, `failed`, `cancelled`, and `retryable`.
- `ProductionSubmission{ID, Owner, BatchID, BookID, VideoID, CompilerSnapshotID, RequestHash, IdempotencyKey, ProviderJobID, Status, Attempt, MediaRef, FailureCode, CreatedAt, UpdatedAt}` is the durable record.
- `SubmitProductionInput{VideoIDs []string, ExpectedBatchRevision int64, IdempotencyKey string}` is validated by Go. Empty keys, duplicate VIDEO IDs, cross-book VIDEO IDs, and non-active compatibility states are rejected.
- `ProductionRepository.CreateOrGetSubmission`, `ClaimQueued`, `RecordProviderJob`, `RecordStatus`, `ListBatchStatus`, and `RecoverActive` are owner scoped and implemented by MemoryStore and MySQLStore.

- [ ] **Step 1: Write failing schema and idempotency tests**

Create `backend/internal/batchfactoryv11/production_store_test.go` with a stable fixture containing one batch, one book, two active videos, and compiler snapshots. Cover all cases below:

~~~text
same owner + same VIDEO + same compiler snapshot + same idempotency key returns the existing submission ID
same idempotency key with a different VIDEO list returns a revision conflict
the same VIDEO with a different compiler snapshot produces a new submission only after the prior terminal status
another owner cannot list, submit, or mutate the submission
a disabled feature gate produces no submission rows and no provider calls
~~~

Create `backend/internal/storage/batch_factory_v11_production_schema_test.go` to assert Migration `1100006` creates `batch_factory_v11_production_submissions`, `batch_factory_v11_production_events`, `batch_factory_v11_media`, `batch_factory_v11_merge_runs`, and `batch_factory_v11_merge_inputs` with owner and status indexes.

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(ProductionSubmission|ProductionSchema|SubmissionIdempotency)' -count=1
~~~

Expected: FAIL because the production schema and repository do not exist.

- [ ] **Step 2: Add Migration 1100006 and transactional repository methods**

Migration `1100006` contains these immutable or append-only rows:

~~~text
batch_factory_v11_production_submissions
  id, owner_username, batch_id, book_id, video_id, compiler_snapshot_id,
  request_hash, idempotency_key, provider_job_id, status, attempt,
  media_ref, failure_code, created_at, updated_at

batch_factory_v11_production_events
  id, submission_id, previous_status, next_status, event_kind,
  provider_payload_sha256, detail_code, created_at

batch_factory_v11_media
  id, owner_username, batch_id, book_id, video_id, object_key,
  content_type, byte_size, sha256, duration_ms, source_submission_id, created_at

batch_factory_v11_merge_runs
  id, owner_username, batch_id, book_id, status, speed, input_manifest_sha256,
  output_media_id, failure_code, created_at, updated_at

batch_factory_v11_merge_inputs
  merge_run_id, ordinal, media_id, object_key, sha256, duration_ms
~~~

The unique idempotency index includes `owner_username`, `idempotency_key`, and `request_hash`. A second key with the same active VIDEO/compiler snapshot is rejected as already in progress; a terminal retry requires a newly compiled snapshot or an explicit retry record, never an untracked duplicate. `RecordStatus` appends one event per legal transition and rejects an illegal transition rather than coercing it.

- [ ] **Step 3: Run repository tests and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(ProductionSubmission|ProductionSchema|SubmissionIdempotency)' -count=1
git add backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): persist idempotent production submissions"
~~~

### Task 2: Dispatch through Go and recover safely after restart

**Interfaces:**

- `ProductionProvider.Submit(ctx context.Context, request ProviderRequest) (providerJobID string, err error)` and `ProductionProvider.Status(ctx context.Context, providerJobID string) (ProviderStatus, error)` are Go-only interfaces.
- `ProductionService.Submit(ctx, owner, batchID string, input SubmitProductionInput) ([]ProductionSubmission, error)` resolves each VIDEO's final prompt by calling `CompileFinalPrompt` before it creates a submission.
- `ProductionWorker.Run(ctx context.Context)` claims at most `MaxConcurrency` rows by `SELECT ... FOR UPDATE SKIP LOCKED`; it never scans jobs owned by another user.
- `RecoverActive(ctx)` turns `submitting` rows without a provider job ID back to `queued`, and retains `submitted`/`running` rows for provider-status polling. It never sends a second provider submit for a row with a provider job ID.

- [ ] **Step 1: Write failing worker tests with a fake Go provider**

Create `backend/internal/batchfactoryv11/production_worker_test.go` with a `fakeProductionProvider` recording every `Submit` and `Status` call. Assert all of the following:

~~~text
two concurrent workers with max concurrency one submit exactly one provider request at a time
duplicate SubmitProduction calls invoke the provider once and return the same submission ID
after a simulated process restart, a submission with provider job ID poll-statuses without resubmitting
a submission stranded in submitting without a provider job ID becomes queued and is submitted once
provider queued, running, succeeded, and failed statuses persist in order and append an event each time
provider success creates exactly one media row with object key, content type, bytes, and SHA-256
~~~

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(ProductionWorker|ProductionRestart|ProductionConcurrency|ProductionProvider)' -count=1
~~~

Expected: FAIL until service, worker, and fake-object plumbing exist.

- [ ] **Step 2: Implement feature gate, compiler dependency, and worker recovery**

Add `QIANTIE_BATCH_FACTORY_V11_PRODUCTION_EXECUTION_ENABLED` and `QIANTIE_BATCH_FACTORY_V11_MAX_CONCURRENCY` parsing to Go config. The execution flag defaults false; malformed boolean or concurrency outside 1 through 8 is a startup configuration error. `ProductionService.Submit` returns `ErrCapabilityUnavailable("production.submit", "external production is disabled")` before it creates a row when the flag is false or no Go provider/object store is configured.

When enabled, the service resolves final prompt snapshots in the same transaction boundary used for submission creation, computes a request hash from owner, VIDEO ID, compiler snapshot ID, canonical model reference, and immutable prompt hash, then persists the job before the worker submits it. Provider response payloads are redacted and hashed; API keys, cookies, authorization headers, and complete provider response bodies are never logged or returned.

Implement `FileObjectStore` only for fresh candidate volumes and an adapter to the existing Go object-store configuration only after its credentials/read/write tests exist. Do not adapt Node files or `lib/batch-factory/production-bridge.js`.

- [ ] **Step 3: Run worker, compiler, and migration regression suites**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(Production|CompileFinalPrompt|V11Migrations)' -count=1
~~~

Expected: PASS. With the production flag false, a fake provider's call log remains empty.

- [ ] **Step 4: Commit the dispatch and recovery slice**

~~~bash
git add backend/internal/batchfactoryv11 backend/internal/storage backend/internal/app backend/internal/config
git commit -m "feat(batch-v11): dispatch and recover Go production jobs"
~~~

### Task 3: Build V11 status APIs and the batch status projection

**Interfaces:**

- `BatchProductionStatus{BatchID, Counts, Books, UpdatedAt}` provides counts for queued, submitting, submitted, running, succeeded, failed, cancelled, and retryable VIDEO states.
- `BookProductionStatus` contains only the current owner's Book and VIDEO IDs, current statuses, media refs, latest failure code, and merge status.
- `GET /api/batch-factory/v11/batches/{batchId}/production-status` is the authoritative source for Phase 5 status center and right-side current-filter results.

- [ ] **Step 1: Write failing HTTP contract tests**

Create `backend/internal/httpapi/batch_factory_v11_production_test.go` with bridge-authenticated requests. Assert unsigned access is `401`, a different owner is `404`, disabled submission is `503` with code `BFV11_EXTERNAL_EXECUTION_DISABLED`, stale batch revision is `409`, invalid video selection is `400`, and these routes return bounded JSON:

~~~text
POST /api/batch-factory/v11/batches/{batchId}/production-submissions
GET  /api/batch-factory/v11/batches/{batchId}/production-status
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/production-status
GET  /api/batch-factory/v11/production-submissions/{submissionId}
~~~

The `POST` response includes `submissions` with IDs, status, compiler snapshot ID, and idempotency key but excludes provider credentials and raw prompt text. The status projection returns current data only from V11 tables; it does not read a Node production project.

- [ ] **Step 2: Implement thin Go handlers and capability changes**

Handlers derive owner from `BridgeIdentityFromContext`, call `ProductionService`, and return the persisted projection. Capability `production.submit` becomes available only when the Go config gate, provider, object store, compiler, and worker are all ready. `merge.run` stays unavailable until Task 4 succeeds. `publish.121` and `publish.yadi` remain unavailable.

- [ ] **Step 3: Run HTTP and transport tests and commit**

~~~bash
go -C backend test ./internal/httpapi ./internal/batchfactoryv11 ./internal/storage -run 'Test(V11Production|Production|CompileFinalPrompt)' -count=1
node --test test/batch-factory-v11-proxy.test.js
git add backend/internal/httpapi backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): expose persistent production status"
~~~

### Task 4: Merge completed V11 VIDEO media without losing sources

**Interfaces:**

- `MergeCapability{Available bool, Reason string, FFmpegPath string}` is calculated by Go from the V11 object store, feature gate, and FFmpeg executable; the browser never decides it.
- `CreateMergeRun(ctx, owner, batchID, bookID string, input MergeInput) (MergeRun, error)` accepts only `Speed` in the inclusive range 1.0 through 2.0 and source VIDEO IDs in their Book ordinal order.
- `MergeRun` transitions `queued -> running -> succeeded|failed`; it saves input manifest SHA-256 before invoking FFmpeg and never deletes source media.

- [ ] **Step 1: Write failing merge tests**

Create `backend/internal/batchfactoryv11/merge_service_test.go` using a temporary FileObjectStore and a fake FFmpeg runner. Cover these cases:

~~~text
merge capability is false when object storage is absent, FFmpeg is absent, or the candidate execution gate is false
merge rejects a Book with any VIDEO not succeeded, another owner's media, duplicate media IDs, wrong order, a speed below 1.0, or a speed above 2.0
the input manifest has stable order and SHA-256 across repeat reads
a successful merge creates one output media row and leaves every source media row/object present
a failed FFmpeg run records failed status and preserves a prior successful merge output
~~~

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(MergeCapability|CreateMergeRun|MergePreservesSources|MergeFailure)' -count=1
~~~

Expected: FAIL because V11 merge service does not exist.

- [ ] **Step 2: Implement bounded FFmpeg merge in Go**

Resolve FFmpeg from `QIANTIE_FFMPEG_PATH` or `exec.LookPath("ffmpeg")`. For each allowed V11 source media record, stream it to a new temporary directory, reject an aggregate input over 2 GiB, build a concat manifest using only generated local filenames, and execute FFmpeg under a 110-second context deadline. Store output at a unique V11 object key containing owner, batch, book, merge run, and filename; never use a stable key that can overwrite an earlier output.

Write the media row first, then mark the MergeRun succeeded. When a new merge succeeds, retain prior output rows and input media; surface the latest successful run in the status projection without deleting history. On failure, record a truncated error code/message of at most 1000 bytes and leave old output retrievable.

- [ ] **Step 3: Add merge routes and capability tests**

Add these bridge-authenticated V11 routes and assertions to `backend/internal/httpapi/batch_factory_v11_merge_test.go`:

~~~text
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/merge-capability
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/merge-runs
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/merge-runs/latest
~~~

Test `401` unsigned, `404` cross-owner, `409` for unfinished VIDEO production, `503` disabled capability, and `201` only after a successful fake V11 merge. Set `merge.run` available only if all capability conditions are true.

- [ ] **Step 4: Run the complete phase suite and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1
node --test test/batch-factory-v11-proxy.test.js test/batch-factory.test.js test/batch-factory-current-mainline-contract.test.js
git add backend/internal/httpapi backend/internal/batchfactoryv11 backend/internal/storage backend/internal/app backend/internal/config
git commit -m "feat(batch-v11): merge completed V11 videos in Go"
~~~

## Phase Gate

- [ ] Migration `1100006` passes empty, schema-one, schema-twenty-six, and repeat-start MySQL 8.4 checks without altering earlier checksums.
- [ ] Idempotent submit, bounded server concurrency, restart recovery, provider polling, terminal failure, and media persistence have automated tests.
- [ ] Batch and Book status responses are stored V11 projections; the Phase 5 status center can display them without old Node production data.
- [ ] Every production request references a Phase 3 compiler snapshot. There is no alternate Node/browser Final Prompt path.
- [ ] Merge verifies input ownership/status/order, preserves original VIDEO media, records immutable manifest/output evidence, and fails safely.
- [ ] In the candidate environment, `production.submit` and `merge.run` report explicit unavailability without any external egress. 121/Yadi remain disabled.

Stop for review before UI controls become operational or before any candidate deployment.
