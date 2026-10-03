# Batch merge artifact retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution selected by the user). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release only local Batch Factory merged MP4s three days after their owner deletes the corresponding book or project.

**Architecture:** Capture local merge artifact references into a MySQL purge ledger within the same transaction as the book/project deletion. A Go cleanup worker claims due rows and uses the existing root-confined artifact store to remove an exact MP4. Node supplies the selected 3/7/14/30-day setting to V12 deletes; TOS remains explicitly unsupported until credentials and an object-deletion adapter are separately configured.

**Tech Stack:** Go, MySQL, existing Batch Factory V11/V12 bridge, local artifact store, Node settings UI.

## Global Constraints

- Work only on V88 and preserve unrelated generated `frontend/dist/downloads/` files.
- Default and public selected retention are 3 days; accepted values are 3, 7, 14, 30.
- Capture only local URLs shaped as `/api/batch-factory/v11/batches/<batch>/merge-media/merge_<id>`.
- Do not clean TOS, 121, uploaded images, executor artifacts, or active merge work.
- A purge failure is retried; it never recreates the deleted project.

---

### Task 1: Durable purge ledger and deletion capture

**Files:**
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/batchfactoryv11/delete_test.go`

**Interfaces:**
- Produces `batch_factory_v11_local_artifact_purges` with owner, batch/book IDs, `storage_ref`, `purge_after`, state, attempts and error fields.
- `DeleteBook` and `DeleteBatch` persist matching local merge artifact references before removing merge-job records.

- [ ] **Step 1: Write failing MySQL-store tests**

```go
func TestDeleteBatchQueuesOnlyItsLocalMergedArtifacts(t *testing.T) {
    // A local merge URL creates a pending `merge_<id>.mp4` purge entry.
    // A https/TOS URL does not create an entry.
}

func TestDeleteBookDoesNotQueueBatchWideMergeArtifact(t *testing.T) {
    // A book delete queues only the same book_id, never a batch-wide merge.
}
```

- [ ] **Step 2: Run tests and verify they fail because no ledger exists**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestDelete(BatchQueues|BookDoes)' -count=1`

- [ ] **Step 3: Add migration and transactional capture**

```go
// SELECT output_url for the exact owner/batch/book scope before DELETE.
// Parse only a validated local merge-media URL into merge_<id>.mp4.
// INSERT IGNORE a pending purge row with purge_after = now + retentionDays.
```

- [ ] **Step 4: Run focused store tests**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/storage -count=1`

### Task 2: Due-entry worker and protected file removal

**Files:**
- Create: `backend/internal/batchfactoryv11/local_artifact_purger.go`
- Create: `backend/internal/batchfactoryv11/local_artifact_purger_test.go`
- Modify: `backend/internal/app/app.go`

**Interfaces:**
- `LocalArtifactPurger.RunOnce(context.Context) (PurgeSummary, error)` claims due ledger rows and calls `localartifact.Store.Remove(storageRef)`.
- `LocalArtifactPurger.Start(context.Context, interval)` performs a startup sweep and bounded periodic sweeps.

- [ ] **Step 1: Write failing worker tests**

```go
func TestLocalArtifactPurgerDeletesDueMergeFile(t *testing.T) {
    // A due pending merge file is removed and ledger state is deleted.
}

func TestLocalArtifactPurgerRejectsTraversalAndKeepsRetryableFailure(t *testing.T) {
    // `../x.mp4` is never removed; a real remove failure increments attempts.
}
```

- [ ] **Step 2: Run tests and verify they fail because the worker is absent**

Run: `cd backend && go test ./internal/batchfactoryv11 -run TestLocalArtifactPurger -count=1`

- [ ] **Step 3: Implement one-at-a-time claims and outcome recording**

```go
// Claim a due pending/retry row in a transaction.
// Remove only a validated ref with the existing Store.Remove method.
// Mark deleted on success or os.ErrNotExist; otherwise set retry and last_error.
```

- [ ] **Step 4: Start the worker after migrations complete**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/app -count=1`

### Task 3: Retention setting and V12 bridge contract

**Files:**
- Modify: `lib/production-retention.js`
- Modify: `lib/production-retention.test.js`
- Modify: `routes/batch-factory-v12.js`
- Modify: `routes/batch-factory-v12.test.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`

**Interfaces:**
- `normalizeProductionRetentionDays` accepts `3`, `7`, `14`, `30` and defaults to `3`.
- V12 delete calls Go with a validated `retentionDays` query value.

- [ ] **Step 1: Write failing Node tests**

```js
test('normalizes a three-day production retention value', () => {
  assert.equal(normalizeProductionRetentionDays(3), 3);
});

test('V12 delete forwards the signed-in retention days to Go', async () => {
  // Capture the real bridge URL and assert `retentionDays=3`.
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test lib/production-retention.test.js routes/batch-factory-v12.test.js`

- [ ] **Step 3: Implement the setting and explicit UI wording**

```js
// Select [3, 7, 14, 30].
// Delete copy: local merged MP4 is retained for the configured period.
// TOS copy: not enabled unless remote cleanup is configured.
```

- [ ] **Step 4: Run Node and frontend source tests**

Run: `node --test lib/production-retention.test.js routes/batch-factory-v12.test.js frontend/src/user/pages/settings-retention-source.test.js`

### Task 4: Release and live acceptance

**Files:**
- Modify only code and tests from Tasks 1-3.

- [ ] **Step 1: Run all targeted checks**

Run: `git diff --check && cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage ./internal/app -count=1 && cd .. && node --test lib/production-retention.test.js routes/batch-factory-v12.test.js`

- [ ] **Step 2: Commit the exact V88 source**

Run: `git add <only changed source/tests/docs> && git commit -m "fix(v88): retain deleted local merge artifacts"`

- [ ] **Step 3: Deploy the exact committed SHA using the V88 public release path**

Run the approved direct deployment, retain the previous image tag for rollback, and never delete Docker volumes.

- [ ] **Step 4: Prove the public boundary**

Create a disposable owner-scoped project with a local merged artifact, delete it through the V12 API with `retentionDays=3`, verify its pending ledger entry and retained file, then make only that test entry due and verify exactly that file is removed. Confirm build SHA, service health and no TOS cleanup claim.
