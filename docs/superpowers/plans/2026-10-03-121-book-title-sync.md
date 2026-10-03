# 121 Book Title Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the 121 book title as the visible Batch Factory title while preserving a user-entered title.

**Architecture:** The Node source-refill step derives a trusted 121 title from `bookinfo.book_name` and sends it with source capture. The Go source-capture contract updates the stored `title` only when the existing title is an empty or generated ID placeholder; metadata continues to retain the raw 121 title for auditability.

**Tech Stack:** Node.js test runner, Go `testing`, Batch Factory V11 Node-to-Go bridge.

## Global Constraints

- `bookId` remains immutable and separate from visible `title`.
- A non-placeholder user title must never be overwritten.
- 121 `bookinfo.book_name` is used only after a successful source fetch.
- Existing source text remains fill-only and is never replaced.

---

### Task 1: Derive and forward the trusted 121 title

**Files:**
- Modify: `lib/batch-factory-v11/source-refill.js`
- Modify: `test/batch-factory-v11-source-refill.test.js`

**Interfaces:**
- Consumes: `fetched.bookinfo.book_name` from `fetchDirectOriginal`.
- Produces: `captureSource({ sourceTitle, sourceMetadata, ... })`.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(captured.sourceTitle, '港岛雨停，再无爱意');
assert.equal(captured.sourceMetadata.sourceBookTitle, '港岛雨停，再无爱意');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/batch-factory-v11-source-refill.test.js`

Expected: failure because `sourceTitle` is absent.

- [ ] **Step 3: Write the minimal implementation**

```js
const sourceTitle = String(fetched?.bookinfo?.work_title || fetched?.bookinfo?.book_name || '').trim();
// Include sourceTitle only when the 121 response supplies one.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/batch-factory-v11-source-refill.test.js`

Expected: all tests pass.

### Task 2: Update the persisted Batch Factory title safely

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/memory_store.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/batchfactoryv11/store_test.go`

**Interfaces:**
- Consumes: `CaptureBookSourceInput.SourceTitle`.
- Produces: returned `Book.Title` containing the 121 title when the prior title is a generated ID placeholder.

- [ ] **Step 1: Write the failing tests**

```go
// A generated "小说 <book id>" title is replaced by sourceTitle.
// A user title such as "手工书名" remains unchanged.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/batchfactoryv11 -run 'TestCaptureBookSource' -count=1`

Expected: failure because source capture currently updates only text and metadata.

- [ ] **Step 3: Write the minimal implementation**

```go
type CaptureBookSourceInput struct { SourceTitle string `json:"sourceTitle,omitempty"`; /* existing fields */ }
// Update title only if it is empty, equals BookID, or equals "小说 "+BookID.
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `go test ./backend/internal/batchfactoryv11 -run 'TestCaptureBookSource' -count=1`

Expected: all matching tests pass.

### Task 3: Verify the bridge contracts

**Files:**
- Verify: `test/batch-factory-v11-source-refill.test.js`
- Verify: `backend/internal/batchfactoryv11/store_test.go`

- [ ] **Step 1: Run the Node and Go regression tests**

Run: `node --test test/batch-factory-v11-source-refill.test.js && go test ./backend/internal/batchfactoryv11 -count=1`

- [ ] **Step 2: Inspect the diff**

Run: `git diff --check && git diff -- lib/batch-factory-v11/source-refill.js backend/internal/batchfactoryv11`

Expected: only title propagation and its tests are changed.
