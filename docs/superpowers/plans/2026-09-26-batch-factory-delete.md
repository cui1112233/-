# Batch Factory Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an owner to delete one batch-factory book or an entire batch project without affecting external 121 content.

**Architecture:** The Go store owns transactional local-data deletion; V11 exposes signed HTTP DELETE handlers; V12 forwards only those two mutation paths. Node automation state is removed only after durable deletion succeeds, and React uses existing confirmation controls with no optimistic removal.

**Tech Stack:** Go `database/sql` and `net/http`; Express; React/Ant Design; Go and Node tests.

**Spec:** `docs/superpowers/specs/2026-09-26-batch-factory-delete-design.md`

## Global Constraints

- V88 only; never modify or switch `master`.
- Scope all deletion by the authenticated owner.
- Delete local batch-factory records only; do not cancel/remove third-party or 121 data.
- Use one DB transaction; a failure rolls back all local record changes.
- Do not reclaim physical local-merge artifacts in this change.

## Review Focus

- Foreign owner/nonexistent IDs return not-found and change nothing.
- A single-book deletion preserves its siblings and an empty parent batch.
- Batch deletion removes dependent local task records before FK parents.
- A failed deletion leaves visible UI data unchanged.
- External 121 submissions are never called by a deletion action.

---

### Task 1: Add transactional owner-scoped deletion to the store

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/memory_store.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Create: `backend/internal/batchfactoryv11/delete_test.go`

**Produces:** `Store.DeleteBook(context.Context, owner, batchID, bookID) error`; `Store.DeleteBatch(context.Context, owner, batchID) error`.

- [ ] Write a failing memory-store test creating a two-book Alice batch, deleting one book, and asserting its sibling remains.
- [ ] Write a failing cross-owner test asserting Bob receives `ErrNotFound` when deleting Alice’s batch.
- [ ] Run `go test ./internal/batchfactoryv11 -run 'TestDelete(BookKeepsSiblingBook|BatchRejectsOtherOwner)' -count=1`; expect compilation failure for missing methods.
- [ ] Add the two methods to `Store` and `MemoryStore`, verifying owner/batch/book before mutation; keep a batch after its last book is deleted.
- [ ] Implement MySQL methods with `BeginTx`; verify scope first, delete task events/hidden rows/tasks/jobs, merge rows, video/director/hook/draft/asset rows, then book rows; for a batch continue through batch snapshots/settings/records/parent. Commit only after every statement succeeds.
- [ ] Run `go test ./internal/batchfactoryv11 -run TestDelete -count=1`; expect PASS.
- [ ] Commit: `feat(batch): add owner scoped deletion`.

### Task 2: Expose exact protected deletion routes

**Files:**
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Create: `backend/internal/httpapi/batch_factory_v11_delete_test.go`
- Modify: `routes/batch-factory-v12.js`
- Modify: `routes/batch-factory-v11.test.js`

**Consumes:** Task 1 store methods. **Produces:** owner-scoped V11 and V12 DELETE endpoints.

- [ ] Write failing signed HTTP tests: Alice DELETEs one book and retains sibling; Bob gets 404; Alice DELETEs a batch then GET returns 404.
- [ ] Write a failing Node route test that DELETE `/api/batch-factory/v12/batches/batch-1` forwards only to signed V11 `/api/batch-factory/v11/batches/batch-1`.
- [ ] Run `go test ./internal/httpapi -run TestDelete -count=1` and `node --test routes/batch-factory-v11.test.js`; expect missing routes/failing contract.
- [ ] Register V11 `DELETE /batches/{batchId}/books/{bookId}` and `DELETE /batches/{batchId}`, call `bridgeOwner`, map errors with `writeStoreError`, and return 204.
- [ ] Keep generic V12 mutation rejection; explicitly allow only these two DELETE patterns to use the existing signed proxy.
- [ ] Re-run both tests; expect PASS.
- [ ] Commit: `feat(batch): expose protected deletion routes`.

### Task 3: Add automation cleanup and confirmed Shuihuo controls

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `test/batch-factory-automation.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/shuihuo/ProjectsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Consumes:** V12 DELETE endpoints. **Produces:** client functions `deleteBatchFactoryBook(batchId, bookId)` and `deleteBatchFactoryProject(batchId)`, plus confirmed actions.

- [ ] Write failing controller test showing deletion cleanup removes only one book’s automation state and preserves its sibling.
- [ ] Write failing source tests requiring `删除本书`, `删除批量项目`, both client functions, `Popconfirm`, and refresh only after await succeeds.
- [ ] Run `node --test test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`; expect failures for absent contract.
- [ ] Add controller cleanup methods that persist only after the API returns success; add the two API client DELETE functions without optimistic state mutation.
- [ ] Add batch-card and book-row `Popconfirm` actions. Copy must say local records are deleted and 121 content is unaffected. On a book success refresh batch/status; on project success return to list and refresh projects; error leaves current UI data intact.
- [ ] Re-run both tests; expect PASS.
- [ ] Commit: `feat(shuihuo): add batch and book deletion controls`.

### Task 4: Verify and release exact V88 commits

**Files:**
- Modify: `C:\Users\Administrator\.codex\CODEX_MEMORY.md` after verified release.

- [ ] Run `go test ./internal/batchfactoryv11 ./internal/httpapi -count=1`; report any unrelated failure by name.
- [ ] Run `node --test routes/batch-factory-v11.test.js test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js` and `npm --prefix frontend run build`; only known asset/chunk warnings are acceptable.
- [ ] Run `git diff --check origin/v88...HEAD`, push exact commit with `git push origin HEAD:v88`, and never touch `master`.
- [ ] Deploy exact-SHA Go and Node images, recreating only `go-api` and `v88-node`; do not restart Nginx, MySQL, or workers.
- [ ] Verify both containers running/restart 0, Node-to-Go `/health` 200, and public `/shuihuo-production` 200. Do not send destructive test DELETEs to real user data.
