# Batch Factory V11 Merge Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party asynchronous merge provider for Batch Factory V11 so completed VIDEO media can be merged into a final MP4 without putting FFmpeg work in the main API process.

**Architecture:** Keep the existing V11 Go API as the orchestration boundary. The API sends an ordered source list to an internal `merge-worker`; the worker validates source URLs, downloads bounded media, executes FFmpeg in a separate container, stores job state behind a provider contract, and returns a task id/output URL through the existing submit/poll adapter. Slice 5 remains disabled until the worker and provider configuration are verified.

**Tech Stack:** Go, MySQL, Redis-backed asynchronous job state/queue, FFmpeg, TOS-compatible object storage, Docker, GitHub Actions.

**Spec:** Approved conversation design “方案 A” on 2026-09-09.

## Global Constraints

- Active source changes go only to branch `v88`; do not modify V78.
- Do not commit or print credentials.
- Do not enable public Slice 5 before worker/provider readiness is verified.
- Merge is all-or-nothing: never report a partial batch movie as complete.
- Preserve ordered VIDEO sources as produced by the existing V11 merge service.
- Keep FFmpeg out of the main `qiantie-api` runtime image.
- Worker source downloads must be bounded and URL-validated; do not implement an unrestricted URL fetcher.

---

### Task 1: Lock the provider contract with tests

**Files:**
- Modify: `backend/internal/batchfactoryv11/merge_adapter_test.go`
- Modify only if required: `backend/internal/batchfactoryv11/merge_adapter.go`

**Interfaces:**
- Consumes: `HTTPMergeAdapter.Submit(ctx, batchID, []MergeMedia, MergeOptions)`
- Produces: ordered JSON `sources[]` carrying `videoId` and `url`, plus timing options; Bearer service authentication.

- [ ] **Step 1: Write failing contract tests** asserting ordered source URLs and auth reach the provider unchanged.
- [ ] **Step 2: Run `go test ./internal/batchfactoryv11 -run 'TestHTTPMergeAdapter' -count=1` and verify the new assertion fails for any missing contract field.**
- [ ] **Step 3: Make the minimum adapter change required by the contract.**
- [ ] **Step 4: Re-run the focused tests and then `go test ./...`.**
- [ ] **Step 5: Commit the green contract slice.**

### Task 2: Add the merge-worker domain and HTTP contract

**Files:**
- Create: `backend/internal/mergeworker/types.go`
- Create: `backend/internal/mergeworker/handler.go`
- Create: `backend/internal/mergeworker/handler_test.go`
- Create: `backend/cmd/merge-worker/main.go`

**Interfaces:**
- `POST /v1/merge` consumes `{batchId,sources,timingMode,speed,ttsSpeed}` and returns `{taskId,status}`.
- `GET /v1/merge/{id}` returns `{taskId,status,outputUrl,errorMessage}`.
- Both endpoints require `Authorization: Bearer <service key>`.

- [ ] **Step 1: Write failing HTTP tests for authentication, ordered sources, validation, queued response, and poll response.**
- [ ] **Step 2: Run focused tests and confirm RED.**
- [ ] **Step 3: Implement minimal handlers behind a queue/store interface, with no FFmpeg in HTTP handlers.**
- [ ] **Step 4: Run focused tests and `go test ./...` until GREEN.**
- [ ] **Step 5: Commit the worker HTTP slice.**

### Task 3: Add bounded media acquisition and FFmpeg execution

**Files:**
- Create: `backend/internal/mergeworker/downloader.go`
- Create: `backend/internal/mergeworker/downloader_test.go`
- Create: `backend/internal/mergeworker/ffmpeg.go`
- Create: `backend/internal/mergeworker/ffmpeg_test.go`

**Interfaces:**
- Downloader accepts only validated HTTP(S) sources and enforces per-file/aggregate byte limits, redirect limits and request timeouts.
- FFmpeg runner receives ordered local source paths and an output path; it normalizes incompatible streams when concat-copy is unsafe and emits MP4.

- [ ] **Step 1: Write failing tests for unsafe URLs, oversized responses, source order and FFmpeg argv construction.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement bounded download and command construction using `exec.CommandContext`, never a shell string.**
- [ ] **Step 4: Verify focused and full Go tests GREEN.**
- [ ] **Step 5: Commit the media execution slice.**

### Task 4: Add Redis job queue/state

**Files:**
- Create: `backend/internal/mergeworker/redis_store.go`
- Create: `backend/internal/mergeworker/redis_store_test.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

**Interfaces:**
- Queue operation: enqueue merge task id once.
- State operations: create queued job, claim as running, finish succeeded/failed, read by id.
- Job records contain no service credentials.

- [ ] **Step 1: Write RED contract tests against the Redis store abstraction.**
- [ ] **Step 2: Add only the required Redis client dependency.**
- [ ] **Step 3: Implement idempotent state transitions and queue operations.**
- [ ] **Step 4: Run focused tests and `go test ./...`.**
- [ ] **Step 5: Commit the Redis slice.**

### Task 5: Add output storage adapter

**Files:**
- Create: `backend/internal/mergeworker/object_store.go`
- Create: `backend/internal/mergeworker/object_store_test.go`

**Interfaces:**
- `Put(ctx, objectKey, reader, size, contentType) (publicOrSignedURL string, err error)`.
- Runtime credentials/config come only from environment.

- [ ] **Step 1: Write failing tests for deterministic object keys, successful upload URL propagation and upload failure.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the smallest TOS-compatible adapter supported by the repository/runtime dependency set.**
- [ ] **Step 4: Verify focused and full tests GREEN.**
- [ ] **Step 5: Commit the storage slice.**

### Task 6: Wire the asynchronous worker loop

**Files:**
- Create: `backend/internal/mergeworker/worker.go`
- Create: `backend/internal/mergeworker/worker_test.go`
- Modify: `backend/cmd/merge-worker/main.go`

**Interfaces:**
- Claim queued task → download ordered inputs → FFmpeg merge → upload MP4 → persist succeeded/output URL; on bounded failure persist failed/error.

- [ ] **Step 1: Write RED end-to-end unit tests using fake downloader/runner/store.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the minimal orchestration loop with context cancellation and temporary-directory cleanup.**
- [ ] **Step 4: Verify focused tests and `go test ./...` GREEN.**
- [ ] **Step 5: Commit the worker loop.**

### Task 7: Containerize without bloating the API image

**Files:**
- Create: `backend/Dockerfile.merge-worker`
- Modify: `docker-compose.v88-review.yml`
- Modify: `.env.v88-review.example`

**Interfaces:**
- `qiantie-api` continues using `backend/Dockerfile` unchanged.
- `merge-worker` image contains FFmpeg and exposes only its internal HTTP port to the Compose network.
- API merge endpoint/poll endpoint target the internal worker service name.

- [ ] **Step 1: Add configuration/compose contract checks that fail while the worker service is absent.**
- [ ] **Step 2: Add the worker image and Compose service with Merge disabled by default.**
- [ ] **Step 3: Build both images and confirm the API image did not gain FFmpeg.**
- [ ] **Step 4: Run repository test/build suites.**
- [ ] **Step 5: Commit the container slice.**

### Task 8: CI and release readiness gate

**Files:**
- Create: `.github/workflows/bf11-merge-worker-verify.yml`
- Modify only if required: `.github/workflows/bf11-integrated-runtime-verify.yml`

**Interfaces:**
- CI must run worker Go tests and build the worker image.
- Release readiness does not equal public enablement.

- [ ] **Step 1: Add CI verification for worker tests/image build.**
- [ ] **Step 2: Push and verify all existing V11 jobs plus worker verification are green.**
- [ ] **Step 3: Confirm `v88` HEAD exact SHA and record it before deployment.**
- [ ] **Step 4: Do not set public Slice 5 yet.**

### Task 9: Public Slice 5 activation and real acceptance

**Files:**
- Runtime configuration only; no credentials committed.

**Interfaces:**
- `QIANTIE_BATCH_FACTORY_V11_SLICE=5`
- `QIANTIE_BATCH_FACTORY_V11_MERGE_ENABLED=1`
- Merge endpoint/poll endpoint point to the internal worker.
- Service API key supplied as runtime secret.

- [ ] **Step 1: Verify worker health from the API network before changing Slice.**
- [ ] **Step 2: Enable Merge configuration and restart only the v88 service set.**
- [ ] **Step 3: Verify authenticated `/api/batch-factory/v11/capabilities` returns `merge.run.available=true`.**
- [ ] **Step 4: Run one real small batch through VIDEO completion → merge queued/running → succeeded.**
- [ ] **Step 5: Verify the returned `outputUrl` serves a playable merged MP4 and survives page refresh/readback.**
- [ ] **Step 6: Record exact public Node/Go/worker build SHA evidence.**
