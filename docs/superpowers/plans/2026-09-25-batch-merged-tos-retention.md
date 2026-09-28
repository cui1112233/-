# Batch merged-video TOS retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution selected by the user). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist merged Batch Factory videos to TOS and remove the local finished artifact only after the remote object has been confirmed.

**Architecture:** Add a narrowly scoped TOS merged-video output adapter to the existing local merge path. It uploads the temporary merged file before a merge job becomes successful. An owner-scoped migration path uploads completed local merge artifacts and only then deletes the local source.

**Tech Stack:** Go, existing Volcengine TOS SDK, MySQL merge-job store, local artifact store.

## Global Constraints

- Git `v88` is the sole source of truth; deploy only an exact committed SHA.
- Use existing TOS credentials and only the `batch-merged/` key prefix.
- A TOS failure must preserve the source artifact and existing playable URL.
- TOS upload is storage only; it must not submit to the video management system.

---

### Task 1: Test and add TOS-backed local merge output

**Files:**
- Modify: `backend/internal/batchfactoryv11/local_merge_adapter.go`
- Modify: `backend/internal/batchfactoryv11/local_merge_adapter_test.go`
- Modify: `backend/internal/mergeworker/object_store.go`

**Interfaces:**
- Consumes: `mergeworker.ObjectStore.PutMerged(ctx, taskID, filePath)`.
- Produces: a local merge job whose `OutputURL` is a TOS URL only after a successful object write.

- [ ] **Step 1: Write the failing test**

```go
func TestLocalMergeAdapterStoresCompletedOutputInTOS(t *testing.T) {
    // A recording object store returns https://media.example/batch-merged/task.mp4.
    // Assert the merge result uses that URL and no local artifact is saved.
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/batchfactoryv11 -run TestLocalMergeAdapterStoresCompletedOutputInTOS -count=1`

- [ ] **Step 3: Implement the minimal optional output-store path**

```go
if a.Output != nil {
    outputURL, err := a.Output.PutMerged(ctx, taskID, outputPath)
    if err != nil { a.fail(taskID, err); return }
    job.OutputURL = outputURL
} else {
    // existing protected local-artifact behaviour
}
```

- [ ] **Step 4: Run the targeted package tests**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/mergeworker -count=1`

### Task 2: Wire configuration and migrate completed local merge artifacts safely

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_merge.go`
- Modify: relevant Go tests beside the changed packages
- Modify: deployment environment wiring for the public Go API

**Interfaces:**
- Consumes: complete `QIANTIE_BATCH_FACTORY_V11_MERGE_TOS_*` settings.
- Produces: owner-scoped migration that changes a merge URL after upload and then removes its matching artifact.

- [ ] **Step 1: Write failing tests**

```go
// incomplete TOS config keeps local merge mode unchanged.
// successful owner migration updates URL then removes the artifact.
// failed upload keeps both source artifact and original URL.
```

- [ ] **Step 2: Run each new test and verify expected failures**

Run: `cd backend && go test ./internal/config ./internal/httpapi -run 'Test.*Merged.*TOS' -count=1`

- [ ] **Step 3: Implement config validation, migration route, and ordered cleanup**

```go
// upload -> persist updated merge job -> remove local artifact
// return an error without removal on either upload or persistence failure
```

- [ ] **Step 4: Run targeted tests and build**

Run: `cd backend && go test ./internal/... -run 'Test(LocalMerge|.*Merged.*TOS)' -count=1 && go build ./cmd/api`

### Task 3: Commit, deploy, and migrate current completed merges

**Files:**
- Modify only files created or changed in Tasks 1-2.

- [ ] **Step 1: Review the diff and run the targeted regression suite**

Run: `git diff --check && cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/mergeworker -count=1`

- [ ] **Step 2: Commit and merge to `v88`**

Run: `git add <changed-files> && git commit -m "feat(batch-factory): store merged videos in tos"`

- [ ] **Step 3: Deploy the exact `v88` SHA and verify its build identity**

Run the approved V88 direct deployment path, then verify the public API build SHA and the authenticated migration endpoint.

- [ ] **Step 4: Migrate only completed current-batch artifacts and verify TOS URLs**

Run the owner-scoped migration endpoint for the current batch; verify updated `https` TOS URLs and that only migrated local artifacts are removed.
