# 独立 Windows 巨量素材执行器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Windows x64 background executor that downloads OCR resources on first use, keeps its OCR worker resident, processes giant-material tasks locally, and returns the cleaned text to the public Batch Factory without modifying the Doubao executor.

**Architecture:** Add a new Go-based Windows agent under `giant-material-executor/`, a separate public Go control-plane package under `backend/internal/giantmaterialexecutor/`, and a browser adapter that talks to the agent over a loopback API. The agent owns pairing, leases, model cache, a long-lived OCR worker, progress, cancellation, and updates; the public service owns Qingyu authorization, task persistence, book registration, and AI publication classification.

**Tech Stack:** Go, MySQL, existing Go HTTP API patterns, Windows x64 build, Python/PaddleOCR worker package downloaded on demand, FFmpeg, NDJSON worker protocol, React/Ant Design, Node test runner, Go tests.

## Global Constraints

- The executor is a separate product and must not modify or reuse the Doubao executor's runtime protocol or installer.
- The first shipped platform is Windows x64; macOS is out of scope for this implementation.
- The installer contains only the lightweight agent and updater; OCR models and the OCR runtime package are downloaded on first use.
- The agent and OCR worker remain resident after a successful task and return to `idle`; they do not exit after each OCR task.
- Permanent Qingyu credentials remain on the public service; the Windows agent receives only short-lived job credentials and allowed media URLs.
- No full MP4, frame image, Cookie, Token, or complete raw log is persisted after a task finishes.
- OCR tasks are serialized per executor; the public queue uses leases, heartbeats, cancellation, retry, and idempotent material/book keys.
- Existing `local-executor/` and its Doubao tests/installers remain unchanged.
- The first real acceptance sample is `7689285397448523826`; no other ID can replace it as the rolling-text fixture.
- Every task ends with focused tests, `git diff --check`, and a small commit.

## File Map

### New Windows executor

- `giant-material-executor/go.mod`: standalone Go module with no dependency on `local-executor/`.
- `giant-material-executor/cmd/giant-material-executor/main.go`: Windows background agent entry point, graceful shutdown, tray/service mode selection.
- `giant-material-executor/internal/agent/state.go`: executor state machine and resident worker lifecycle.
- `giant-material-executor/internal/agent/agent.go`: pairing, polling, lease renewal, result submission, cancellation.
- `giant-material-executor/internal/modelcache/cache.go`: model/runtime manifest, resumable download, hash verification, atomic activation.
- `giant-material-executor/internal/httpapi/server.go`: loopback control API for the public page.
- `giant-material-executor/internal/worker/client.go`: resident OCR worker process supervisor and NDJSON protocol.
- `giant-material-executor/internal/update/manager.go`: signed update manifest and updater handoff.
- `giant-material-executor/worker/ocr_worker.py`: Windows OCR worker protocol implementation.
- `giant-material-executor/scripts/build-windows.ps1`: reproducible x64 build and package staging.
- `giant-material-executor/installer/giant-material-executor.nsi`: small NSIS installer and auto-start registration.

### Public control plane

- `backend/internal/giantmaterialexecutor/types.go`: pairing, executor, job, lease, result, and status types.
- `backend/internal/giantmaterialexecutor/store.go`: service/store interface and validation.
- `backend/internal/giantmaterialexecutor/memory_store.go`: deterministic unit-test store.
- `backend/internal/giantmaterialexecutor/mysql_store.go`: account-scoped durable MySQL implementation.
- `backend/internal/giantmaterialexecutor/service.go`: pairing, claim, heartbeat, progress, result, fail, cancel, idempotency.
- `backend/internal/httpapi/giant_material_executor.go`: authenticated browser routes and executor bearer-token routes.
- `backend/internal/storage/giant_material_executor_schema.go`: MySQL migration for pairings, executors, jobs, events, and results.

### Frontend

- `frontend/src/shared/api/giantMaterialExecutor.js`: loopback capability, pairing, task, status, cancel API.
- `frontend/src/shared/api/giantMaterialExecutor.test.js`: request and normalization tests.
- `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx`: reusable executor status/progress panel.
- `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.test.js`: status rendering contract tests.
- `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.jsx`: route giant OCR through the executor when available and preserve current server/local fallback messaging.

---

### Task 1: Freeze the resident Windows agent state machine

**Files:**
- Create: `giant-material-executor/go.mod`
- Create: `giant-material-executor/internal/agent/state.go`
- Create: `giant-material-executor/internal/agent/state_test.go`
- Create: `giant-material-executor/cmd/giant-material-executor/main.go`

**Interfaces:**
- `type State string` with `idle`, `pairing`, `downloading_model`, `ready`, `running`, `cleaning`, `uploading`, `failed`, `stopping`.
- `type Snapshot struct { State State; JobID string; ModelVersion string; Progress Progress; ErrorCode string; ErrorMessage string }`.
- `type StateMachine struct { ... }` with `Transition(next State) error`, `Snapshot() Snapshot`, and `ResetToIdle()`.
- A completed job must transition to `idle`, never to a terminal process exit.

- [ ] **Step 1: Write the failing state tests.**

```go
func TestSuccessfulJobReturnsToIdleAndKeepsWorkerResident(t *testing.T) {
    machine := NewStateMachine()
    for _, state := range []State{StateReady, StateRunning, StateCleaning, StateUploading} {
        if err := machine.Transition(state); err != nil { t.Fatal(err) }
    }
    if err := machine.Transition(StateIdle); err != nil { t.Fatal(err) }
    if got := machine.Snapshot().State; got != StateIdle { t.Fatalf("state=%s", got) }
}

func TestInvalidTransitionDoesNotSilentlyStopTheAgent(t *testing.T) {
    machine := NewStateMachine()
    if err := machine.Transition(StateUploading); err == nil { t.Fatal("expected invalid transition") }
    if got := machine.Snapshot().State; got != StateIdle { t.Fatalf("state=%s", got) }
}
```

- [ ] **Step 2: Run the tests and verify the missing package failure.**

Run: `cd giant-material-executor && go test ./internal/agent`

Expected: FAIL because the state machine types do not exist.

- [ ] **Step 3: Implement the state machine and a minimal Windows-safe main loop.**

Use a mutex around the snapshot, validate transitions with an explicit map, and make `main.go` block on a signal instead of exiting after one task. The main loop must expose a `stop` context to future worker, HTTP, and updater components.

- [ ] **Step 4: Run the focused tests and static checks.**

Run: `cd giant-material-executor && go test ./internal/agent && go vet ./...`

- [ ] **Step 5: Commit the standalone agent skeleton.**

```bash
git add giant-material-executor/go.mod giant-material-executor/internal/agent giant-material-executor/cmd/giant-material-executor/main.go
git commit -m "feat(giant-executor): add resident agent state machine"
```

### Task 2: Add resumable first-use model/runtime caching

**Files:**
- Create: `giant-material-executor/internal/modelcache/cache.go`
- Create: `giant-material-executor/internal/modelcache/cache_test.go`
- Create: `giant-material-executor/internal/modelcache/manifest.go`

**Interfaces:**
- `type Manifest struct { Version string; PackageURL string; Size int64; SHA256 string; RuntimeVersion string }`.
- `type Cache struct { Root string; Client *http.Client }`.
- `func (c Cache) Ensure(ctx context.Context, manifest Manifest, progress func(DownloadProgress)) (ModelInstall, error)`.
- `ModelInstall` returns the immutable active directory and version; failed `.part` files never become active.

- [ ] **Step 1: Write failing tests for cache reuse, interrupted download, hash failure, and atomic activation.**

Use `httptest.Server` with a byte payload and `Range` handling. Assert a complete cache makes zero network requests, a `.part` file resumes from its byte length, a mismatched SHA-256 leaves the old active version untouched, and progress never reports completion before the rename.

- [ ] **Step 2: Run the focused tests to confirm red.**

Run: `cd giant-material-executor && go test ./internal/modelcache`

Expected: FAIL because `Cache.Ensure` is not implemented.

- [ ] **Step 3: Implement the cache.**

Store files under `%LOCALAPPDATA%\\YizhanShengming\\GiantMaterialExecutor\\models\\<version>`, download to `<version>.part`, use `Range` when the server supports it, hash the final bytes, then rename to the version directory. Return explicit errors `MODEL_DOWNLOAD_FAILED`, `MODEL_HASH_MISMATCH`, and `MODEL_MANIFEST_INVALID`.

- [ ] **Step 4: Run the tests and verify the model remains resident.**

Run: `cd giant-material-executor && go test ./internal/modelcache -count=1`

- [ ] **Step 5: Commit the cache.**

```bash
git add giant-material-executor/internal/modelcache
git commit -m "feat(giant-executor): add resumable OCR model cache"
```

### Task 3: Implement the public giant-executor control plane

**Files:**
- Create: `backend/internal/giantmaterialexecutor/types.go`
- Create: `backend/internal/giantmaterialexecutor/store.go`
- Create: `backend/internal/giantmaterialexecutor/memory_store.go`
- Create: `backend/internal/giantmaterialexecutor/mysql_store.go`
- Create: `backend/internal/giantmaterialexecutor/service.go`
- Create: `backend/internal/giantmaterialexecutor/service_test.go`
- Create: `backend/internal/httpapi/giant_material_executor.go`
- Create: `backend/internal/httpapi/giant_material_executor_test.go`
- Modify: `backend/internal/storage/giant_material_executor_schema.go`
- Modify: `backend/internal/httpapi/router.go`, adding a separate `RegisterGiantMaterialExecutorRoutes` call without changing the Doubao route.

**Interfaces:**
- Browser: `CreatePairing`, `CreateJob`, `GetJob`, `CancelJob`.
- Executor: `Pair`, `Heartbeat`, `Claim`, `Renew`, `Progress`, `Complete`, `Fail`.
- Job payload contains `jobID`, `materialID`, `platformBookID`, `title`, `videoURL`, `videoExpiresAt`, `modelVersion`, and a short-lived lease token.

- [ ] **Step 1: Write service tests before routes.**

Cover one-time pairing expiry, platform separation (`giant_material` never claims a Doubao job), one active lease per job, stale lease rejection, heartbeat timeout, cancellation, result idempotency by `materialID + platformBookID + modelVersion`, and completion returning the job to a durable `succeeded` state while the executor remains online.

- [ ] **Step 2: Run the Go tests and confirm red.**

Run: `cd backend && go test ./internal/giantmaterialexecutor ./internal/httpapi`

Expected: FAIL because the package, migration, and routes are absent.

- [ ] **Step 3: Implement the memory service and route contracts.**

Use the existing `localexecutor` pairing/lease patterns as reference only; keep new tables, tokens, paths, and platform names separate. Limit result body size to 2 MiB and redact video URLs and tokens from errors.

- [ ] **Step 4: Implement MySQL persistence and migration.**

Create account-scoped tables for `giant_executor_pairings`, `giant_executors`, `giant_executor_jobs`, `giant_executor_job_events`, and `giant_executor_results`, with indexes for claim state, lease expiry, owner, and idempotency. Add the migration to the backend application migration list.

- [ ] **Step 5: Run focused Go tests and migration checks.**

Run: `cd backend && go test ./internal/giantmaterialexecutor ./internal/httpapi ./internal/storage`

- [ ] **Step 6: Commit the control plane.**

```bash
git add backend/internal/giantmaterialexecutor backend/internal/httpapi/giant_material_executor.go backend/internal/httpapi/giant_material_executor_test.go backend/internal/storage/giant_material_executor_schema.go
git commit -m "feat(giant-executor): add Windows OCR task control plane"
```

### Task 4: Add the resident OCR worker protocol and Windows worker package

**Files:**
- Create: `giant-material-executor/internal/worker/protocol.go`
- Create: `giant-material-executor/internal/worker/supervisor.go`
- Create: `giant-material-executor/internal/worker/supervisor_test.go`
- Create: `giant-material-executor/worker/ocr_worker.py`
- Create: `giant-material-executor/worker/requirements-lock.txt`
- Create: `giant-material-executor/worker/protocol_test.py`
- Reuse behavior rules from: `lib/giant-material/scroll-merge.mjs`, `lib/giant-material/scroll-extractor.mjs`, and `lib/giant-material/scroll-merge.test.mjs`

**Interfaces:**
- Worker input NDJSON: `{"type":"ensure_model","modelDir":"..."}`, `{"type":"extract","jobId":"...","videoUrl":"...","durationSeconds":281}`, `{"type":"cancel","jobId":"..."}`, `{"type":"shutdown"}`.
- Worker output NDJSON: `ready`, `progress`, `complete`, `failed`, `idle`.
- `Supervisor.Start(ctx)`, `Supervisor.Submit(ctx, ExtractRequest)`, `Supervisor.Cancel(jobID)`, `Supervisor.Stop(ctx)`.

- [ ] **Step 1: Write protocol tests for resident behavior.**

Assert the worker accepts a second `extract` request after a `complete` without process restart, emits `idle` after completion, rejects unsafe non-HTTPS/non-Qingyu URLs, sends progress counts without frame text, and emits a single failure followed by `idle` on cancellation.

- [ ] **Step 2: Run Python and Go tests to confirm red.**

Run: `python -m pytest giant-material-executor/worker/protocol_test.py` and `cd giant-material-executor && go test ./internal/worker`

- [ ] **Step 3: Implement the Python worker.**

Use a versioned first-use OCR runtime bundle (embedded Python, PaddleOCR dependencies, model weights, and the required FFmpeg binary) downloaded through the model cache, FFmpeg streaming decode, the existing crop/scroll-overlap semantics, and a bounded NDJSON stdout protocol. The installer must not contain that bundle. Do not write MP4 or frame artifacts to persistent application storage. Keep the process alive after `complete` and release only per-job temporary files.

- [ ] **Step 4: Implement the Go supervisor.**

Start the worker once, keep stdin/stdout pipes open, validate every output record, restart the worker after an unexpected exit, and mark the current lease retryable. Never pass the public Qingyu Token to the worker.

- [ ] **Step 5: Run worker tests with a fake worker and local fixture.**

Run: `python -m pytest giant-material-executor/worker/protocol_test.py` and `cd giant-material-executor && go test ./internal/worker -count=1`

- [ ] **Step 6: Commit the resident worker.**

```bash
git add giant-material-executor/internal/worker giant-material-executor/worker
git commit -m "feat(giant-executor): keep Windows OCR worker resident"
```

### Task 5: Connect the agent to the public queue and loopback browser API

**Files:**
- Modify: `giant-material-executor/internal/agent/agent.go`
- Create: `giant-material-executor/internal/httpapi/server.go`
- Create: `giant-material-executor/internal/httpapi/server_test.go`
- Create: `frontend/src/shared/api/giantMaterialExecutor.js`
- Create: `frontend/src/shared/api/giantMaterialExecutor.test.js`

**Interfaces:**
- Loopback base URL: `http://127.0.0.1:17861`.
- `GET /v1/health` returns `{online, version, state}`.
- `GET /v1/capabilities` returns `{platform:"windows", ocr:true, modelVersion, modelReady}`.
- `POST /v1/pair` accepts a one-time public pairing code.
- `POST /v1/jobs` accepts a public job ID and starts/queues it locally.
- `GET /v1/jobs/:id` returns status/progress/error only.
- `POST /v1/jobs/:id/cancel` requests cancellation.

- [ ] **Step 1: Write loopback and frontend API tests.**

Assert non-loopback bind is rejected, unknown origins are rejected, `/health` never exposes tokens, a missing model returns `downloading_model` rather than `running`, and the browser client normalizes offline, model-missing, running, complete, and failed states.

- [ ] **Step 2: Run focused tests and confirm red.**

Run: `cd giant-material-executor && go test ./internal/httpapi`; `node --test frontend/src/shared/api/giantMaterialExecutor.test.js`

- [ ] **Step 3: Implement the agent polling and lease loop.**

The browser creates a one-time pairing code on the authenticated public API; the user enters that code into the local executor (or the browser passes it through the loopback pairing panel), and only the resulting short-lived executor credential is stored locally. After pairing, heartbeat every 15 seconds, claim only `giant_material` jobs, renew the lease while the resident worker runs, submit progress at most once per second, complete with bounded正文 JSON, and return the worker to `idle`.

- [ ] **Step 4: Implement the loopback server and frontend client.**

Bind only to `127.0.0.1`, enforce a generated local nonce and the configured public origin, and never accept arbitrary shell commands or arbitrary executable paths from the browser.

- [ ] **Step 5: Run focused tests and commit.**

Run: `cd giant-material-executor && go test ./...`; `node --test frontend/src/shared/api/giantMaterialExecutor.test.js`

```bash
git add giant-material-executor/internal/agent giant-material-executor/internal/httpapi frontend/src/shared/api/giantMaterialExecutor.js frontend/src/shared/api/giantMaterialExecutor.test.js
git commit -m "feat(giant-executor): connect resident agent to public jobs"
```

### Task 6: Route the Batch Factory giant-material flow through the executor

**Files:**
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: the batch backend result registration handler that currently receives the giant OCR intake.

**Interfaces:**
- `createGiantMaterialJob(id, selectedBook, contentRangeLines)` creates a public job.
- `subscribeGiantMaterialJob(jobID, onState)` polls or subscribes until `succeeded`, `failed`, or `cancelled`.
- Completed results reuse `buildGiantMaterialIntake` and the existing `appendNovelFetchIntake` path.

- [ ] **Step 1: Write UI tests for executor status and fallback.**

Assert the modal shows “执行器未安装 / 正在下载模型 / 正在 OCR / 已完成 / 失败原因”, never reports success before a non-empty正文 arrives, and does not create a second book when the same job/result is retried.

- [ ] **Step 2: Run the tests to confirm red.**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.test.js`

- [ ] **Step 3: Implement executor-first routing.**

When the Windows executor is online, create a public job and display its progress. When it is offline, show the install/start action; do not silently call the Mac-only `/__local/giant-material-test/extract` endpoint for Windows. Preserve the current source label, Book ID selection, line-range setting, and AI classification after registration.

- [ ] **Step 4: Add cancellation, retry, and idempotent result registration.**

Cancellation must leave metadata visible but must not create a book. Retry only the failed stage/job. A succeeded `materialID + platformBookID` must reuse the existing book/intake.

- [ ] **Step 5: Run targeted frontend tests and commit.**

Run: `node --test frontend/src/user/pages/ShuihuoProductionPage.source.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.test.js`

```bash
git add frontend/src/shared/api/giantMaterialExecutor.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx
git commit -m "feat(batch): use Windows giant material executor"
```

### Task 7: Add the small Windows installer and resident startup

**Files:**
- Create: `giant-material-executor/scripts/build-windows.ps1`
- Create: `giant-material-executor/installer/giant-material-executor.nsi`
- Create: `giant-material-executor/internal/update/manager.go`
- Create: `giant-material-executor/internal/update/manager_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`

**Interfaces:**
- Build output: `dist/windows-x64/GiantMaterialExecutor-<version>.exe`.
- Update manifest fields: `version`, `url`, `sha256`, `signature`, `minimumAgentVersion`.
- Installer registers Windows startup/tray launch without requiring an administrator account when installed per-user.

- [ ] **Step 1: Write updater tests.**

Assert an invalid hash is rejected, a lower version is ignored, a downloaded update is staged outside the active binary, active jobs defer update, and a verified update restarts the background agent after replacement.

- [ ] **Step 2: Implement the updater and graceful handoff.**

Pause new claims, wait for the resident OCR worker to return to `idle`, launch a signed updater, exit the old process, atomically replace the binary, and relaunch the agent. The updater must close after relaunch and must never execute user-provided shell text.

- [ ] **Step 3: Implement NSIS and PowerShell packaging.**

Build a Windows x64 agent without model weights. Add per-user installation, auto-start, uninstall preservation of model cache, and a tray shortcut. The script must fail if model files are accidentally included in the installer staging directory.

- [ ] **Step 4: Run package checks.**

Run on a Windows x64 runner: `powershell -ExecutionPolicy Bypass -File giant-material-executor/scripts/build-windows.ps1`; inspect the installer size and run `signtool verify` or the configured signature verifier.

- [ ] **Step 5: Commit packaging.**

```bash
git add giant-material-executor/scripts giant-material-executor/installer giant-material-executor/internal/update giant-material-executor/cmd/giant-material-executor/main.go
git commit -m "feat(giant-executor): add Windows installer and updater"
```

### Task 8: Windows end-to-end acceptance

**Files:**
- Create: `giant-material-executor/test/acceptance/giant_material_windows_acceptance.ps1`
- Modify: `docs/superpowers/specs/2026-09-29-giant-material-windows-executor-design.md` with measured package/model sizes and acceptance evidence.

- [ ] **Step 1: Prepare a clean Windows x64 machine or VM.**

Install only the signed agent package, open the local public page, and confirm the agent reports `online` without OCR models present.

- [ ] **Step 2: Verify first-use model preparation.**

Submit `7689285397448523826`, observe `downloading_model`, interrupt the download, resume it, and confirm the final SHA-256 before OCR begins.

- [ ] **Step 3: Verify resident OCR.**

Wait for the rolling sample to produce non-empty text, confirm the worker returns to `idle` without process exit, submit a second task, and verify that the model is reused without another download.

- [ ] **Step 4: Verify public registration and AI classification.**

Confirm title, platform Book ID, source `巨量素材 · 7689285397448523826`,正文, and classification state are persisted exactly once in the Batch Factory list.

- [ ] **Step 5: Verify recovery and update.**

Test cancel, expired video URL, offline public API, worker crash/restart, and update while idle. Confirm no Token, Cookie, MP4, or frame files remain in persistent user storage.

- [ ] **Step 6: Run final checks and report boundaries.**

Run all Go tests, Python protocol tests, focused frontend tests, `git diff --check`, and the Windows package size check. Report separately whether public server fallback is enabled; do not claim it merely from a successful local executor run.
