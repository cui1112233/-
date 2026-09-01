# V78 Doubao Local Executor Slice 2 Job Leasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable local VIDEO job queue and lease/state protocol needed for the replacement executor to receive work without duplicate generation.

**Architecture:** Extend the existing `localexecutor` Go package with a separate job service and MySQL persistence. Website-authenticated V78 routes create/cancel jobs for the current owner; device routes authenticate with executor bearer token and use a lease token plus generation counter for every mutation. Acceptance is an irreversible boundary: once recorded, the job is frozen to that executor/account/submission and cannot be safely reassigned for another submission.

**Tech Stack:** Go 1.23 standard library, MySQL 8.4, existing Qiantie BridgeAuth, Node Express public gateway.

**Spec:** `docs/superpowers/specs/2026-09-01-v78-doubao-local-executor-full-replacement-design.md`

## Global Constraints

- Work on `feat/v78-doubao-local-executor-replacement`.
- Preserve existing V11 migration checksums.
- Keep existing pairing/token behavior from Slice 1.
- One job has at most one active lease.
- A device mutation requires both executor bearer token and current lease token/generation.
- `acceptance_unknown` is not treated as `not_accepted`.
- After positive acceptance evidence, no route may release the job back to a state that permits a fresh submission on another account.
- Cancellation is desired state and must stop future retries/resubmissions.
- Cloud never receives Doubao cookies/passwords/session material.

---

## File Structure

- Create: `backend/internal/localexecutor/jobs_types.go` — job states, payload, lease and mutation DTOs.
- Create: `backend/internal/localexecutor/jobs.go` — job validation/state machine/service.
- Create: `backend/internal/localexecutor/jobs_test.go` — state-machine tests.
- Modify: `backend/internal/localexecutor/memory_store.go` — deterministic job store for tests.
- Modify: `backend/internal/localexecutor/mysql_store.go` — transactional claim/renew/state persistence.
- Modify: `backend/internal/storage/local_executor_schema.go` — migration `7801002` for jobs/events/artifacts foundation.
- Modify: `backend/internal/storage/local_executor_schema_test.go` — migration contract.
- Modify: `backend/internal/httpapi/local_executor.go` — website enqueue/cancel and device claim/renew/progress/acceptance/release/fail/result endpoints.
- Modify: `backend/internal/httpapi/local_executor_test.go` — auth/lease/stale/cancel tests.
- Create: `routes/local-executor-device.js` — narrow public Node proxy for `/api/local-executor/v1/*`.
- Create: `test/local-executor-device-proxy.test.js` — proxy tests.
- Modify: `app.js` — mount the public device proxy without website `apiAuth`.

### Task 1: Add job state machine and lease invariants

**Interfaces:**

```go
type JobState string
const (
    JobQueued JobState = "queued"
    JobLeased JobState = "leased"
    JobPreparing JobState = "preparing"
    JobSubmitting JobState = "submitting"
    JobAcceptanceUnknown JobState = "acceptance_unknown"
    JobAccepted JobState = "accepted"
    JobGenerating JobState = "generating"
    JobDownloading JobState = "downloading"
    JobUploading JobState = "uploading"
    JobSucceeded JobState = "succeeded"
    JobFailed JobState = "failed"
    JobCancelled JobState = "cancelled"
)
```

`CreateJob(ctx, owner string, input CreateJobInput) (JobView, error)` creates `queued`.

`ClaimJob(ctx, executorToken string) (ClaimResult, error)` returns one owner-matching queued/expired-safe job, a random lease token, lease generation, and 60-second expiry.

`RenewJob(ctx, executorToken, jobID string, lease LeaseCredential) (LeaseView, error)` extends only the current lease.

`RecordProgress(...)`, `RecordAcceptance(...)`, `ReleaseJob(...)`, `FailJob(...)`, `CompleteJob(...)`, and `CancelJob(...)` enforce legal transitions.

- [ ] **Step 1: Write failing tests** for single active claim, stale lease rejection, cancellation, acceptance freeze, and download retry not changing acceptance.
- [ ] **Step 2: Run `cd backend && go test ./internal/localexecutor -run 'TestJob|TestClaim|TestAcceptance|TestCancel' -count=1` and confirm RED.**
- [ ] **Step 3: Implement the minimum state machine and in-memory job store.** Generate 32-byte lease tokens, store only hashes, increment lease generation on each claim, and compare current lease before every mutation.
- [ ] **Step 4: Re-run localexecutor tests and confirm GREEN.**
- [ ] **Step 5: Commit `feat(v78): add local executor job state machine`.**

### Task 2: Persist jobs transactionally in MySQL

Migration `7801002` creates:

```sql
CREATE TABLE IF NOT EXISTS local_executor_jobs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  source_task_id VARCHAR(96) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  state VARCHAR(32) NOT NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  lease_executor_id VARCHAR(64) NULL,
  lease_token_hash BINARY(32) NULL,
  lease_generation BIGINT NOT NULL DEFAULT 0,
  lease_expires_at DATETIME(6) NULL,
  accepted_at DATETIME(6) NULL,
  accepted_account_id VARCHAR(191) NULL,
  submission_id VARCHAR(191) NULL,
  artifact_id VARCHAR(64) NULL,
  error_code VARCHAR(96) NULL,
  error_message VARCHAR(512) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_local_executor_job_source (owner_username, source_task_id),
  KEY idx_local_executor_jobs_claim (owner_username, state, cancel_requested, lease_expires_at, created_at)
) ENGINE=InnoDB;
```

and a bounded `local_executor_job_events` audit table plus `local_executor_artifacts` metadata table.

Claim uses a transaction/row lock and only considers the authenticated executor owner's jobs. An expired lease is reclaimable only when no acceptance was recorded; accepted jobs remain pinned and require same-executor recovery semantics.

- [ ] **Step 1: Add failing migration/store contract tests.**
- [ ] **Step 2: Run storage/localexecutor RED tests.**
- [ ] **Step 3: Implement migration and MySQL job methods.**
- [ ] **Step 4: Run storage/localexecutor GREEN tests and all existing V11 checksum tests.**
- [ ] **Step 5: Commit `feat(v78): persist local executor jobs`.**

### Task 3: Expose website/device job APIs

Website routes use existing signed BridgeAuth:

- `POST /api/shuihuo-production/local-executor-jobs`
- `GET /api/shuihuo-production/local-executor-jobs/{id}`
- `PUT /api/shuihuo-production/local-executor-jobs/{id}/cancel`

Device routes use executor Bearer token:

- `POST /api/local-executor/v1/jobs/claim`
- `POST /api/local-executor/v1/jobs/{id}/renew`
- `POST /api/local-executor/v1/jobs/{id}/progress`
- `POST /api/local-executor/v1/jobs/{id}/acceptance`
- `POST /api/local-executor/v1/jobs/{id}/release`
- `POST /api/local-executor/v1/jobs/{id}/fail`
- `POST /api/local-executor/v1/jobs/{id}/result`

Every mutation body includes `leaseToken` and `leaseGeneration` except claim. `result` is metadata-only in Slice 2; binary/artifact upload is Slice 3.

- [ ] **Step 1: Write failing HTTP tests for owner isolation, bearer auth, stale lease, accepted-release conflict, and cancellation desired state.**
- [ ] **Step 2: Run HTTP RED tests.**
- [ ] **Step 3: Implement handlers and service error mapping.**
- [ ] **Step 4: Run HTTP/localexecutor GREEN tests.**
- [ ] **Step 5: Commit `feat(v78): expose local executor job api`.**

### Task 4: Add narrow public device proxy

`routes/local-executor-device.js` forwards only `/api/local-executor/v1/` paths to `QIANTIE_GO_BASE_URL`. It does not use website `apiAuth`; it forwards `Authorization`, JSON content type/body, request ID, status, content type and response body. It rejects non-local-executor target paths and does not add bridge credentials.

- [ ] **Step 1: Write failing Node tests proving pair/heartbeat/jobs paths forward and Bearer headers survive.**
- [ ] **Step 2: Run `node --test test/local-executor-device-proxy.test.js` and confirm RED.**
- [ ] **Step 3: Implement proxy and mount `app.use('/api/local-executor/v1', createLocalExecutorDeviceRouter(...))`.**
- [ ] **Step 4: Run Node tests and syntax checks.**
- [ ] **Step 5: Commit `feat(v78): expose local executor device gateway`.**

### Task 5: Full Slice 2 verification

- [ ] Run `cd backend && go test ./... -count=1`.
- [ ] Run `node --test test/local-executor-device-proxy.test.js` and `node --check routes/local-executor-device.js app.js`.
- [ ] Compare branch to its pre-Slice-2 HEAD and verify no existing V11 migration content changed.
- [ ] Verify no schema/API contains Doubao credentials/cookies/session material.
- [ ] Stop at a truthful checkpoint: the replacement can pair and safely receive/cancel jobs, but live Doubao browser automation and binary artifact upload remain the next plans.