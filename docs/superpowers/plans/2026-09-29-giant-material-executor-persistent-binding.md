# Giant Material Executor Persistent Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows giant-material executor pair once, persist its credential securely, and automatically reconnect on later launches.

**Architecture:** Keep the existing public `ExecutorRecord` and owner-scoped queue. Add a small local credential-store interface used by the executable entrypoint; the pair callback persists the returned executor token, while startup loads it and starts the resident agent without pairing. The loopback health endpoint exposes binding/reconnect state for the existing status bar.

**Tech Stack:** Go 1.23, standard library, Windows DPAPI via a small build-tagged adapter, existing Go HTTP client/agent, Go tests.

## Global Constraints

- Pairing codes are first-bind credentials only; normal jobs never require a pairing code.
- Persist only the executor token/device identity; Qingyu admin credentials remain server-side.
- Preserve unrelated dirty worktree changes.
- Keep the worker resident between jobs.
- Do not claim Windows/public end-to-end success without running that boundary explicitly.

### Task 1: Define persistent credential storage contract

**Files:**
- Create: `giant-material-executor/internal/credential/store.go`
- Create: `giant-material-executor/internal/credential/store_test.go`

**Interfaces:**
- Produces `credential.Record`, `credential.Store`, `credential.FileStore`, and `credential.NewFileStore(path string) *FileStore`.
- `Store.Load() (Record, error)`, `Store.Save(Record) error`, and `Store.Clear() error`.

- [ ] **Step 1: Write the failing tests**

Test that an empty store returns `ErrNotFound`, saving a token/device ID then loading it returns the same values, and clearing removes the record. Test malformed JSON returns a non-nil error without exposing the token in the error text.

- [ ] **Step 2: Run the credential tests to verify they fail**

Run `go test ./internal/credential -run Test -v` from `giant-material-executor`.
Expected: package/files or symbols are missing, so the tests fail for the unimplemented store.

- [ ] **Step 3: Implement the minimal file store**

Use JSON with fields `executorId`, `token`, and `savedAt`; create the parent directory with mode `0700`, write a temporary file with mode `0600`, then rename it into place. Reject blank tokens and blank executor IDs. Return `ErrNotFound` for a missing file and never include the token in error messages.

- [ ] **Step 4: Run the credential tests to verify they pass**

Run `go test ./internal/credential -run Test -v` and expect all tests to pass.

- [ ] **Step 5: Commit the isolated unit**

Run `git add giant-material-executor/internal/credential && git commit -m "feat(executor): add persistent credential store"`.

### Task 2: Add platform-safe protected storage adapter

**Files:**
- Create: `giant-material-executor/internal/credential/protection.go`
- Create: `giant-material-executor/internal/credential/protection_windows.go`
- Create: `giant-material-executor/internal/credential/protection_other.go`
- Modify: `giant-material-executor/internal/credential/store.go`
- Modify: `giant-material-executor/internal/credential/store_test.go`
- Modify: `giant-material-executor/go.mod` and `giant-material-executor/go.sum` only if the selected Windows API dependency is required.

**Interfaces:**
- `credential.NewProtectedStore(path string) Store` returns a store that protects the serialized record before writing.
- Windows uses user-scoped DPAPI; non-Windows tests use the file store so local development remains runnable.

- [ ] **Step 1: Write the failing protection tests**

Add a round-trip test using a temporary path and a test record. Assert the on-disk payload is not the JSON token and that `Load` returns the original record.

- [ ] **Step 2: Run the focused tests to verify the new assertions fail**

Run `go test ./internal/credential -run TestProtectedStore -v`.
Expected: the protected store constructor or protection functions are not yet available.

- [ ] **Step 3: Implement the adapters**

Keep the store contract unchanged. On Windows call `CryptProtectData`/`CryptUnprotectData` with current-user scope. On non-Windows wrap the file store so the module remains testable on macOS; document that the production Windows binary uses DPAPI.

- [ ] **Step 4: Run focused and cross-compile tests**

Run `go test ./internal/credential -v` and `GOOS=windows GOARCH=amd64 go test ./internal/credential`.
Expected: both commands exit 0.

- [ ] **Step 5: Commit the protected adapter**

Run `git add giant-material-executor/internal/credential giant-material-executor/go.mod giant-material-executor/go.sum && git commit -m "feat(executor): protect persisted device credentials"`.

### Task 3: Persist pair result and automatically restore the resident agent

**Files:**
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`
- Create: `giant-material-executor/cmd/giant-material-executor/main_test.go` if entrypoint helpers are extracted for testing.
- Modify: `giant-material-executor/internal/httpapi/server.go` and `server_test.go` only for explicit binding-state fields.

**Interfaces:**
- Add `loadExecutorCredential()`, `saveExecutorCredential(agent.PairResult)`, and `clearExecutorCredential()` helpers around `credential.Store`.
- The pair callback saves the returned token before `startAgent`.
- Startup loads a saved token before serving requests; `GIANT_MATERIAL_EXECUTOR_TOKEN` remains an explicit development override.

- [ ] **Step 1: Write failing startup/pair tests**

Test that a successful pair writes a record, a second startup with the record starts the agent without calling `Pair`, and a failed/unauthorized heartbeat clears the record and reports `needsPairing`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run `go test ./cmd/giant-material-executor ./internal/httpapi -run 'Test.*(Pair|Restore|Credential)' -v`.
Expected: the tests fail because startup currently only reads `GIANT_MATERIAL_EXECUTOR_TOKEN` and the pair callback does not persist its result.

- [ ] **Step 3: Implement persistent startup and pair flow**

Select the per-user credential path under the existing `YizhanShengming/GiantMaterialExecutor` config directory. Load it at startup, start the agent when valid, save pair results atomically, and clear the record when the public API returns unauthorized. Do not log token values. Keep the loopback nonce independent from the public executor token.

- [ ] **Step 4: Run focused tests**

Run `go test ./cmd/giant-material-executor ./internal/httpapi -v` and expect all tests to pass.

- [ ] **Step 5: Commit the startup behavior**

Run `git add giant-material-executor/cmd/giant-material-executor giant-material-executor/internal/httpapi && git commit -m "feat(executor): restore paired device on startup"`.

### Task 4: Expose binding/reconnect state in the loopback health contract

**Files:**
- Modify: `giant-material-executor/internal/agent/state.go`
- Modify: `giant-material-executor/internal/httpapi/server.go`
- Modify: `giant-material-executor/internal/httpapi/server_test.go`
- Modify: `frontend/src/shared/api/giantMaterialExecutor.js` and its tests only if the current client needs new fields.
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx` and its test.

**Interfaces:**
- Health JSON adds `bindingState` with values `unpaired`, `connecting`, `online`, `offline`, or `needs_pairing`.
- Existing `online`, `state`, `modelReady`, and `workerResident` fields remain backward compatible.

- [ ] **Step 1: Write failing contract/UI tests**

Assert the health response includes the binding state and the UI renders “已绑定在线”, “已绑定离线”, or “需要重新绑定” instead of showing an installation warning for a paired-but-offline executor.

- [ ] **Step 2: Run the focused tests to verify failure**

Run the Go HTTP tests and the targeted frontend executor-status tests. Expected: the new binding-state assertions fail.

- [ ] **Step 3: Implement the binding state**

Derive the initial state from credential presence, update it around startup/heartbeat failures, serialize it in health, and map it to the existing status bar copy without changing the job submission API.

- [ ] **Step 4: Run focused tests**

Run the same Go and Node test commands and expect all to pass.

- [ ] **Step 5: Commit the status contract**

Run `git add giant-material-executor/internal/agent giant-material-executor/internal/httpapi frontend/src/shared/api/giantMaterialExecutor.js frontend/src/shared/api/giantMaterialExecutor.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.jsx frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialExecutorStatus.test.js && git commit -m "feat(executor): show persistent binding status"`.

### Task 5: Regression verification and local restart smoke test

**Files:**
- No production files unless a test exposes a defect.

- [ ] **Step 1: Run all giant-executor Go tests and vet**

Run `go test ./... && go vet ./...` from `giant-material-executor`.

- [ ] **Step 2: Run backend tests**

Run `go test ./...` from `backend`.

- [ ] **Step 3: Run targeted frontend tests and build**

Run the existing giant-material executor/import/status test list, then `npm run build` from `frontend`.

- [ ] **Step 4: Run the restart smoke test**

Build the executor, start it with a temporary config directory and loopback nonce, verify health reports resident worker state, stop it, restart it with the same credential fixture, and verify it starts without a new pairing request. Do not use a real public token in logs or artifacts.

- [ ] **Step 5: Review the diff and report boundaries**

Run `git diff --check` and `git status --short`. Report local evidence separately from the still-unverified Windows installer/public deployment boundary.
