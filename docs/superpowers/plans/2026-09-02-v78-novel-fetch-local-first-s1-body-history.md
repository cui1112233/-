# V78 Novel Fetch Local-First S1 Body/History Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate long-lived novel-fetch history/task metadata from full original/AI body content so bodies can later be cleaned independently without deleting history.

**Architecture:** Keep the existing signed Node→Go bridge, but split persistence into lightweight task documents plus compressed body objects keyed by user/book/version. S1 keeps the current server 121 Browser Worker and does not enable automatic body deletion yet; it only establishes the safe data boundary and compatibility migration.

**Tech Stack:** Node.js/Express, Go 1.23 `net/http`, MySQL 8.4, gzip, SHA-256, Node `node:test`, Go `testing`, `go-sqlmock` for MySQL-store unit tests.

**Spec:** `docs/superpowers/specs/2026-09-02-v78-novel-fetch-local-first-design.md`

## Global Constraints

- Node baseline: `fc1f5a96364518f0f14073fd5195363ef0e15a77` on `feat/v78-novel-fetch-v2-completion`.
- Go baseline: `13e40da4092046846ad13c5c0bbb15918216465a` on `feat/v78-novel-fetch-go-bridge`.
- Node implementation branch must be `feat/v78-novel-fetch-local-first-s1-node` created from the exact Node baseline.
- Go implementation branch must be `feat/v78-novel-fetch-local-first-s1-go` created from the exact Go baseline.
- Keep Node and Go as separate reviewed SHAs; their histories are diverged and S1 must not force-merge them.
- Do not touch `master`, production deployment branches, or the live ECS runtime.
- Keep the existing server 121 Browser Worker working in S1.
- History/list APIs must not return full body text.
- Default behavior still creates no real `.txt` file.
- `originalRaw` must not remain as a second long-lived full-body copy.
- Automatic retention/deletion is **not enabled in S1**; S5 owns timed cleanup.
- Signed bridge authentication/canonical payload behavior must remain unchanged.

## Execution Order

Execute exactly in this order: **Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**.

---

### Task 1: Add MySQL Body Object Migration

**Files:**
- Modify: `backend/internal/storage/novel_fetch_workshop_schema.go`
- Modify: `backend/internal/storage/novel_fetch_workshop_schema_test.go`

**Interfaces:**
- Consumes: migration `1200001`.
- Produces: migration `1200002`, checksum `novel-fetch-workshop-v2-bodies`, table `novel_fetch_workshop_bodies`.

- [ ] **Step 1: Write the failing migration test**

```go
func TestNovelFetchWorkshopBodyMigration(t *testing.T) {
    migrations := NovelFetchWorkshopMigrations()
    if len(migrations) != 2 { t.Fatalf("migrations=%d", len(migrations)) }
    if migrations[1].Version != 1200002 { t.Fatalf("version=%d", migrations[1].Version) }
    joined := strings.Join(migrations[1].SQL, "\n")
    for _, want := range []string{
        "CREATE TABLE IF NOT EXISTS novel_fetch_workshop_bodies",
        "version_id VARCHAR(64) NOT NULL",
        "content_blob LONGBLOB NOT NULL",
        "content_hash CHAR(64) NOT NULL",
        "char_count BIGINT UNSIGNED NOT NULL",
        "PRIMARY KEY (owner_username, book_id, version_id)",
    } {
        if !strings.Contains(joined, want) { t.Fatalf("missing %q", want) }
    }
}
```

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/storage -run TestNovelFetchWorkshopBodyMigration -v
```

Expected: FAIL because `1200002` does not exist.

- [ ] **Step 3: Add the migration**

Use this table contract:

```sql
CREATE TABLE IF NOT EXISTS novel_fetch_workshop_bodies (
  owner_username VARCHAR(191) NOT NULL,
  book_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  content_encoding VARCHAR(16) NOT NULL DEFAULT 'gzip',
  content_blob LONGBLOB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  char_count BIGINT UNSIGNED NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  last_needed_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  PRIMARY KEY (owner_username, book_id, version_id),
  KEY idx_nfw_bodies_owner_updated (owner_username, updated_at),
  KEY idx_nfw_bodies_owner_expiry (owner_username, expires_at)
) ENGINE=InnoDB
```

- [ ] **Step 4: Verify GREEN**

```bash
cd backend
go test ./internal/storage -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/storage/novel_fetch_workshop_schema.go backend/internal/storage/novel_fetch_workshop_schema_test.go
git commit -m "feat(novel-fetch): add body object schema"
```

---

### Task 2: Add Body Types, Codec, and Store Interface

**Files:**
- Create: `backend/internal/novelfetchworkshop/body_codec.go`
- Create: `backend/internal/novelfetchworkshop/body_codec_test.go`
- Modify: `backend/internal/novelfetchworkshop/store.go`

**Interfaces:**

```go
type BodyRef struct {
    VersionID   string `json:"versionId"`
    Revision    uint64 `json:"revision"`
    ContentHash string `json:"contentHash"`
    CharCount   int64  `json:"charCount"`
    State       string `json:"state"`
    UpdatedAt   string `json:"updatedAt"`
}

type BodyRecord struct {
    BodyRef
    BookID  string `json:"bookId"`
    Content string `json:"content"`
}
```

Extend `Store` with:

```go
PutBody(context.Context, string, BodyRecord) (BodyRef, error)
GetBody(context.Context, string, string, string) (BodyRecord, error)
ListBodyRefs(context.Context, string, string) ([]BodyRef, error)
DeleteBody(context.Context, string, string, string) (bool, error)
```

- [ ] **Step 1: Write codec RED test**

```go
func TestBodyCodecRoundTrip(t *testing.T) {
    text := "第一章\n你好，世界。"
    blob, hash, chars, err := encodeBody(text)
    if err != nil { t.Fatal(err) }
    if chars != int64(len([]rune(text))) { t.Fatalf("chars=%d", chars) }
    if len(hash) != 64 { t.Fatalf("hash=%q", hash) }
    got, err := decodeBody(blob, "gzip")
    if err != nil { t.Fatal(err) }
    if got != text { t.Fatalf("got=%q", got) }
}
```

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run TestBodyCodecRoundTrip -v
```

- [ ] **Step 3: Implement codec**

Rules: SHA-256 the UTF-8 bytes before gzip; `CharCount` counts runes; reject unknown encoding; codec does not write files.

- [ ] **Step 4: Extend `MemoryStore`**

Store bodies by owner → book → version and deep-copy records on read. `ListBodyRefs` must never include `Content`.

- [ ] **Step 5: Verify GREEN**

```bash
cd backend
go test ./internal/novelfetchworkshop -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/internal/novelfetchworkshop/store.go backend/internal/novelfetchworkshop/body_codec.go backend/internal/novelfetchworkshop/body_codec_test.go
git commit -m "feat(novel-fetch): add body store contract"
```

---

### Task 3: Implement MySQL Body Persistence

**Files:**
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`
- Modify: `backend/internal/novelfetchworkshop/mysql_store.go`
- Create: `backend/internal/novelfetchworkshop/mysql_store_body_test.go`

**Interfaces:** consumes Task 2; produces MySQL implementations of the four body methods.

- [ ] **Step 1: Add test-only SQL mock dependency**

```bash
cd backend
go get github.com/DATA-DOG/go-sqlmock@v1.5.2
```

- [ ] **Step 2: Write RED MySQL tests**

Cover: insert, update revision, get+decode, 404/`ErrNotFound`, list refs without content, delete only selected version.

Example assertion shape:

```go
ref, err := store.PutBody(ctx, "alice", BodyRecord{
    BookID: "123", BodyRef: BodyRef{VersionID: "ai3", State: "ready"}, Content: "正文",
})
if err != nil { t.Fatal(err) }
if ref.VersionID != "ai3" || len(ref.ContentHash) != 64 { t.Fatalf("ref=%+v", ref) }
```

- [ ] **Step 3: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run 'MySQL.*Body' -v
```

- [ ] **Step 4: Implement SQL methods**

Use gzip blob storage. Upsert the same `(owner, book, version)` by incrementing `revision`. `GetBody` updates `last_needed_at`; `ListBodyRefs` selects metadata columns only.

- [ ] **Step 5: Verify GREEN**

```bash
cd backend
go test ./internal/novelfetchworkshop ./internal/storage -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/novelfetchworkshop/mysql_store.go backend/internal/novelfetchworkshop/mysql_store_body_test.go
git commit -m "feat(novel-fetch): persist compressed body objects"
```

---

### Task 4: Add Dedicated Signed Body Bridge Endpoints

**Files:**
- Modify: `backend/internal/httpapi/novel_fetch_workshop.go`
- Modify: `backend/internal/httpapi/novel_fetch_workshop_test.go`

**Interfaces:**

```text
GET    /api/novel-fetch-workshop/tasks/{bookId}/bodies
GET    /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}
PUT    /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}
DELETE /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}
```

PUT JSON:

```json
{"content":"正文","state":"ready"}
```

- [ ] **Step 1: Add RED signed round-trip test**

Test with the real bridge middleware: PUT `ai3` → GET exact Chinese text → LIST metadata with no `content` key → DELETE → GET returns 404.

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/httpapi -run 'NovelFetch.*Body' -v
```

- [ ] **Step 3: Implement routes**

Reuse book ID validation. Add `versionId` pattern `^[A-Za-z0-9_.-]{1,64}$`. Keep existing max request size. Do not change signed canonical payload logic.

- [ ] **Step 4: Keep legacy task endpoints**

Do not remove existing task GET/PUT endpoints in S1.

- [ ] **Step 5: Verify Go slice**

```bash
cd backend
gofmt -w internal/novelfetchworkshop internal/httpapi internal/storage
go test ./internal/httpapi ./internal/novelfetchworkshop ./internal/storage -v
go build ./...
```

- [ ] **Step 6: Commit**

```bash
git add backend/internal/httpapi/novel_fetch_workshop.go backend/internal/httpapi/novel_fetch_workshop_test.go
git commit -m "feat(novel-fetch): expose signed body bridge"
```

---

### Task 5: Migrate Existing Full-Text Documents Safely

**Files:**
- Create: `backend/internal/novelfetchworkshop/legacy_document_migration.go`
- Create: `backend/internal/novelfetchworkshop/legacy_document_migration_test.go`
- Modify: `backend/internal/novelfetchworkshop/mysql_store.go`

**Interfaces:**

```go
MigrateLegacyDocumentBodies(ctx context.Context, owner, bookID string) error
```

- [ ] **Step 1: Write RED migration test**

Input legacy JSON:

```json
{"original":"规范原文","originalRaw":"原始原文","versions":{"ai1":"AI1","ai3":"AI3"}}
```

Assert after migration: body `original`=`规范原文`; body `ai1` and `ai3` exist; no second `originalRaw` body; task JSON has no full text; second migration is a no-op and does not increment body revisions.

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run LegacyDocument -v
```

- [ ] **Step 3: Implement transactionally**

Lock one document row, create only missing body rows, replace full-text fields with lightweight body-ref metadata, then commit. Never delete the task/history row.

- [ ] **Step 4: Wire lazy migration**

When `GetDocument` encounters the legacy full-text shape, migrate that one record and re-read it. Do not run a blocking full-table startup migration.

- [ ] **Step 5: Verify GREEN**

```bash
cd backend
go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -v
go build ./...
```

- [ ] **Step 6: Commit**

```bash
git add backend/internal/novelfetchworkshop/legacy_document_migration.go backend/internal/novelfetchworkshop/legacy_document_migration_test.go backend/internal/novelfetchworkshop/mysql_store.go
git commit -m "feat(novel-fetch): migrate legacy full-text documents"
```

---

### Task 6: Migrate Node Workshop Adapter to Metadata + Bodies

**Files:**
- Modify: `lib/novel-fetch-workshop/mysql-store.js`
- Modify: `tests/novel-fetch-mysql-fetch-contract.test.js`
- Modify: `tests/novel-fetch-v2-task-list-bridge.test.js`
- Modify: `tests/novel-fetch-task-api.test.js`
- Modify: `tests/novel-fetch-runner.test.js`
- Modify: `tests/novel-fetch-runner-advanced.test.js`

**Interfaces:**

```js
readBody(bookId, versionId)            // Promise<string>
writeBody(bookId, versionId, content, state = 'ready') // Promise<bodyRef>
listBodyRefs(bookId)                   // Promise<bodyRef[]>
deleteBody(bookId, versionId)          // Promise<boolean>
```

`listTasks()` remains compatible with the UI and must return lightweight booleans/metadata such as `hasOriginal`, `hasAi`, and `bodyVersions`, but never the full `original`, `originalRaw`, or `versions` text objects.

- [ ] **Step 1: Write RED list test**

```js
assert.equal('original' in task, false);
assert.equal('originalRaw' in task, false);
assert.equal('versions' in task, false);
assert.equal(task.hasOriginal, true);
assert.equal(task.hasAi, true);
assert.deepEqual(task.bodyVersions.sort(), ['ai1', 'ai3', 'original']);
```

- [ ] **Step 2: Write RED original-fetch persistence test**

Assert `fetchOriginal()` sends full normalized text only to `PUT .../bodies/original`; task PUT contains metadata/status only and does not contain the novel text or `originalRaw`.

- [ ] **Step 3: Verify RED**

```bash
node --test tests/novel-fetch-mysql-fetch-contract.test.js tests/novel-fetch-v2-task-list-bridge.test.js tests/novel-fetch-task-api.test.js
```

- [ ] **Step 4: Implement adapter split**

Task document persisted through Node becomes lightweight:

```js
{
  bookId,
  meta,
  bodyRefs: {
    original: { versionId: 'original', revision, contentHash, charCount, state, updatedAt },
    ai3: { versionId: 'ai3', revision, contentHash, charCount, state, updatedAt }
  },
  logs
}
```

Full body strings go only through body endpoints. Normalize fetched original once, store one `original` body, and retain only raw/processed counts or hashes in metadata when diagnostics need them.

- [ ] **Step 5: Preserve legacy method contracts**

`readVersionText(username, bookId, 'original')` reads body `original`; AI versions map directly (`ai1`, `ai3`, `ai5`, etc.). Internal task callers may receive body availability metadata, but list/history paths must never auto-fetch bodies.

- [ ] **Step 6: Verify Node focused suite**

```bash
node --test \
  tests/novel-fetch-mysql-fetch-contract.test.js \
  tests/novel-fetch-v2-task-list-bridge.test.js \
  tests/novel-fetch-task-api.test.js \
  tests/novel-fetch-runner.test.js \
  tests/novel-fetch-runner-advanced.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/novel-fetch-workshop/mysql-store.js tests/novel-fetch-mysql-fetch-contract.test.js tests/novel-fetch-v2-task-list-bridge.test.js tests/novel-fetch-task-api.test.js tests/novel-fetch-runner.test.js tests/novel-fetch-runner-advanced.test.js
git commit -m "feat(novel-fetch): separate history metadata from bodies"
```

---

### Task 7: Prove Existing 121 Upload Still Works Without Real TXT

**Files:**
- Modify: `tests/novel-fetch-upload-browser-worker.test.js`
- Modify: `tests/novel-fetch-upload-source-contract.test.js`
- Production expectation: no change to `routes/novel-fetch-upload.js`; stop and investigate if the new regression test fails before changing upload behavior.

**Interfaces:** consumes `readVersionText`; produces unchanged 121 multipart behavior.

- [ ] **Step 1: Add regression test**

Create a workshop item whose `ai3` exists only in the Body Store. Assert upload body contains UTF-8 AI3 text and multipart headers equivalent to:

```text
name="files[]"
filename="123456.txt"
Content-Type: text/plain
```

There must be no real `123456.txt` on disk.

- [ ] **Step 2: Run upload tests**

```bash
node --test tests/novel-fetch-upload-browser-worker.test.js tests/novel-fetch-upload-source-contract.test.js
```

Expected: PASS through existing `readVersionText()` abstraction. If RED, stop and identify the broken abstraction before editing `routes/novel-fetch-upload.js`.

- [ ] **Step 3: Commit tests**

```bash
git add tests/novel-fetch-upload-browser-worker.test.js tests/novel-fetch-upload-source-contract.test.js
git commit -m "test(novel-fetch): preserve 121 upload from body store"
```

---

### Task 8: S1 Integration Verification and Handoff

**Files:**
- Create: `tests/novel-fetch-body-history-contract.test.js`

**Interfaces:** produces two exact reviewed SHAs for S2.

- [ ] **Step 1: Add final Node contract test**

Test one book with `original + ai1 + ai3` and assert:
1. list/history response contains no full text;
2. body refs report three versions;
3. removing one body through the fake bridge does not remove task metadata;
4. selected body remains usable by upload source resolution.

- [ ] **Step 2: Run Node focused suite**

```bash
node --test \
  tests/novel-fetch-body-history-contract.test.js \
  tests/novel-fetch-mysql-fetch-contract.test.js \
  tests/novel-fetch-v2-task-list-bridge.test.js \
  tests/novel-fetch-task-api.test.js \
  tests/novel-fetch-runner.test.js \
  tests/novel-fetch-runner-advanced.test.js \
  tests/novel-fetch-upload-browser-worker.test.js \
  tests/novel-fetch-upload-source-contract.test.js
```

Expected: PASS.

- [ ] **Step 3: Run broader Node novel-fetch suite**

```bash
node --test tests/novel-fetch-*.test.js
```

Expected: no new failures. Any pre-existing unrelated failure must be named explicitly in the handoff.

- [ ] **Step 4: Run Go verification**

```bash
cd backend
gofmt -w internal/novelfetchworkshop internal/httpapi internal/storage
go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -v
go build ./...
```

Expected: PASS/build succeeds.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review`. Reviewer must check: no hidden full-text duplication in task JSON; body-list API never leaks content; lazy migration is idempotent; old server 121 upload is unchanged.

- [ ] **Step 6: Record exact handoff SHAs**

Node branch is exactly `feat/v78-novel-fetch-local-first-s1-node`; run `git rev-parse HEAD` in that worktree and report the 40-character result.

Go branch is exactly `feat/v78-novel-fetch-local-first-s1-go`; run `git rev-parse HEAD` in that worktree and report the 40-character result.

Do not merge either branch into production from this task.

---

## S1 Exit Criteria

S1 is complete only when all are true:

1. Full original/AI bodies are outside long-lived task/history JSON.
2. History/list requests never retrieve full body content.
3. `originalRaw` is not kept as a permanent duplicate full text.
4. Existing legacy books migrate safely and idempotently before Node relies on the new shape.
5. Existing server 121 upload still works from body data without a real TXT file.
6. Automatic body deletion remains disabled until S5.
7. Node and Go exact SHAs pass their focused tests/build and code review.

## Subsequent Separate Plans

After S1 passes, create and execute these reviewable plans in order:

1. **S2 Local Executor Body Sync & Export** — device pairing, local internal body store, cloud→local sync, download/export, exported-file override tracking.
2. **S3 Local 121 Login & Upload** — web login entry preserved, local headless Chromium/session, manual verification fallback, local body upload.
3. **S4 Multi-Device Lease & Transfer** — primary/backup routing, leases, duplicate-upload protection, 24-hour explicit relay.
4. **S5 Cleanup Settings & Capacity Guard** — navigation settings, default 7 days/range 1–30, local+cloud cleanup, manual history clear, safe capacity cleanup.
5. **S6 Server Browser Worker Retirement** — only after S3–S5 production-equivalent verification; then remove server Browser Worker from release packaging.
