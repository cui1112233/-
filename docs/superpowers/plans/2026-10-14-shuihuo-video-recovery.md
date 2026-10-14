# Shuihuo Video Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unavailable video tasks from remaining indefinitely in `running`, persist verified provider configuration across Go restarts, and recover only tasks with a fresh provider receipt.

**Architecture:** The Node automation controller will interpret a queued/running task with a terminal configuration or authorization error as a failed VIDEO, so its existing retry policy exposes a terminal state instead of a false wait. Its persisted recovery ledger will remove entries whose batches no longer exist. Go will store provider settings encrypted with a key derived from the required bridge secret, reload them through a MySQL-backed registry, and never return a stored API key through status APIs.

**Tech Stack:** Node.js `node:test`, Go, MySQL, existing V11 migration runner and HTTP bridge.

## Global Constraints

- Work from current `origin/v88`; do not use the dirty legacy checkout as source.
- No credential values in Git, logs, browser storage, tests, screenshots, or status responses.
- Do not replay failed or blocked provider jobs until a provider health check establishes a valid credential and the resumed task returns a provider receipt.
- Release source must be committed to the V88 lineage and production verification must include exact SHA plus persisted task/readback evidence.

---

### Task 1: Classify terminal provider failures and remove dead recovery jobs

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `test/batch-factory-automation.test.js`

**Interfaces:**
- Consumes: `ProductionTask.status` and `ProductionTask.errorMessage` from the Go readback contract.
- Produces: terminal `failed/video` book state for unavailable/authorization provider errors, and a persisted ledger without deleted batches.

- [ ] **Step 1: Write the failing tests**

```js
test('a running VIDEO task with an unavailable provider error stops instead of waiting forever', async () => {
  // A task reported as running but carrying "capability unavailable: video provider is not configured"
  // must make controller.status(...).books[0] become failed/video without another submission.
});

test('live-source recovery removes a persisted job when its batch no longer exists', async () => {
  // A loadBatch() not-found response must remove that job from the persisted ledger and warn once.
});
```

- [ ] **Step 2: Run the focused tests and verify each fails because the existing controller keeps the task waiting / ledger entry.**

Run: `node --test test/batch-factory-automation.test.js`

- [ ] **Step 3: Implement the smallest behavior change.**

```js
function taskHasTerminalProviderError(task) {
  const error = text(task?.errorMessage).toLowerCase();
  return /capability unavailable|not configured|unauthorized|forbidden|http 401|http 403/.test(error);
}
```

Treat such a task as `failed` before it can enter the `active` collection. In `resumeAfterLiveSourceArrival`, remove only a job whose `loadBatch()` failure is the explicit not-found condition; retain and back off all other service failures.

- [ ] **Step 4: Run the focused Node test file until it passes, then run the automation route regression suite.**

Run: `node --test test/batch-factory-automation.test.js routes/batch-factory-v11.test.js`

### Task 2: Persist provider configuration without exposing API keys

**Files:**
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Create: `backend/internal/batchfactoryv11/video_provider_mysql.go`
- Modify: `backend/internal/batchfactoryv11/video_provider.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/batchfactoryv11/video_provider_test.go`
- Create: `backend/internal/batchfactoryv11/video_provider_mysql_test.go`

**Interfaces:**
- Consumes: `VideoProviderRegistry` and the required `config.Config.BridgeSecret`.
- Produces: a durable `VideoProviderRegistry` that returns configuration only to authenticated server-side execution and returns only `VideoProviderConfigView` to callers.

- [ ] **Step 1: Write failing Go tests.**

```go
func TestMySQLVideoProviderRegistryRestoresEncryptedConfig(t *testing.T) {
  // Put a YFAI configuration, construct a fresh registry over the same DB,
  // resolve it, and verify endpoint/model/key are restored while View never returns the key.
}

func TestMySQLVideoProviderRegistryRejectsTamperedCiphertext(t *testing.T) {
  // A modified encrypted credential must return ErrUnavailable/ErrInvalid,
  // never a partial configuration.
}
```

- [ ] **Step 2: Run the new tests and verify they fail before implementation.**

Run: `go test ./internal/batchfactoryv11 -run 'TestMySQLVideoProviderRegistry'`

- [ ] **Step 3: Implement the migration and registry.**

Use AES-GCM with a 32-byte key derived from `sha256("qiantie-v11-video-provider-v1\\x00" + BridgeSecret)`. Store `owner_username`, normalized provider, model, endpoint fields, workflow ID, encrypted API key, and timestamps under a unique owner/provider key. The `Put` path validates before encrypting; `Resolve` decrypts only for server execution; `View` has no key field.

- [ ] **Step 4: Build the registry in `app.Build`.**

Replace `NewMemoryVideoProviderRegistry()` with the MySQL registry initialized from the existing mandatory bridge secret. Preserve `VideoProviderRegistry` so HTTP routes and production services remain unchanged.

- [ ] **Step 5: Run focused Go tests and the app/package regression suite.**

Run: `go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/app ./internal/storage`

### Task 3: Commit, deploy, and recover only validated work

**Files:**
- Modify: `docs/superpowers/plans/2026-10-14-shuihuo-video-recovery.md` to mark verified steps.

- [ ] **Step 1: Run source checks and inspect the diff.**

Run: `node --test test/batch-factory-automation.test.js routes/batch-factory-v11.test.js && (cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/app ./internal/storage) && git diff --check && git status --short`

- [ ] **Step 2: Commit the focused change and integrate it into current `v88` through the repository-approved flow.**

- [ ] **Step 3: Stage/cut over the exact SHA using the current approved, traceable production release path; record its rollback SHA.**

- [ ] **Step 4: Verify public `/api/build-info`, authenticated task status, and provider status without exposing secrets.**

- [ ] **Step 5: After a fresh provider credential produces a health receipt, recover only the eight capability-blocked tasks idempotently; leave the two 403 failures stopped until their credential is replaced. Verify produced media and video-management-system readback before declaring the batch complete.**
