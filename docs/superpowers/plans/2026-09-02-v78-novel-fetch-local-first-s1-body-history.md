# V78 Novel Fetch Local-First S1 Body/History Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate long-lived novel-fetch task/history metadata from full original/AI body content so body data can later be cleaned independently without deleting history.

**Architecture:** Keep the existing signed Node→Go bridge, but split the Go persistence model into lightweight task documents and compressed body objects keyed by user/book/version. Node keeps the current workshop API surface during migration, while its store adapter reads/writes bodies through dedicated bridge endpoints and exposes only body availability metadata in task lists.

**Tech Stack:** Node.js/Express, Go `net/http`, MySQL 8.4, gzip, SHA-256, Node `node:test`, Go `testing`.

**Spec:** `docs/superpowers/specs/2026-09-02-v78-novel-fetch-local-first-design.md`

## Global Constraints

- Node/V78 behavior baseline: `fc1f5a96364518f0f14073fd5195363ef0e15a77` (`feat/v78-novel-fetch-v2-completion`).
- Go bridge baseline: `13e40da4092046846ad13c5c0bbb15918216465a` (`feat/v78-novel-fetch-go-bridge`).
- Keep Node and Go as separate reviewed SHAs; do not force-merge their diverged histories just to implement this slice.
- Do not touch `master`, public production deployment branches, or the live ECS runtime in this plan.
- Keep the existing server 121 Browser Worker working in S1; 121 localization is a later plan.
- History/list APIs must not return full body text after this slice.
- Default behavior still produces no real `.txt` file.
- `originalRaw` must not remain as a second long-lived full-body copy after migration.
- Body deletion and automatic retention are not enabled in S1; this slice only creates the safe separation required for later cleanup.
- Existing signed bridge authentication and canonical payload format must remain compatible.

---

## File Structure / Ownership

### Go slice

- `backend/internal/storage/novel_fetch_workshop_schema.go` — MySQL schema/migration for body objects.
- `backend/internal/storage/novel_fetch_workshop_schema_test.go` — migration contract tests.
- `backend/internal/novelfetchworkshop/store.go` — metadata/body interfaces and in-memory test store.
- `backend/internal/novelfetchworkshop/mysql_store.go` — MySQL task metadata + compressed body persistence.
- `backend/internal/novelfetchworkshop/body_codec.go` — gzip/SHA-256 body encode/decode; no SQL or HTTP.
- `backend/internal/novelfetchworkshop/body_codec_test.go` — codec round-trip tests.
- `backend/internal/httpapi/novel_fetch_workshop.go` — dedicated body HTTP bridge endpoints.
- `backend/internal/httpapi/novel_fetch_workshop_test.go` — auth/API round-trip coverage.

### Node slice

- `lib/novel-fetch-workshop/mysql-store.js` — adapter that maps legacy workshop operations to metadata + dedicated body endpoints.
- `tests/novel-fetch-mysql-fetch-contract.test.js` — original fetch persistence contract.
- `tests/novel-fetch-v2-task-list-bridge.test.js` — list/history no-body contract.
- `tests/novel-fetch-task-api.test.js` — task detail/body availability behavior.
- `tests/novel-fetch-upload-browser-worker.test.js` — regression that 121 upload still obtains selected body content.

---

### Task 1: Add the MySQL Body Object Schema

**Files:**
- Modify: `backend/internal/storage/novel_fetch_workshop_schema.go`
- Modify: `backend/internal/storage/novel_fetch_workshop_schema_test.go`

**Interfaces:**
- Consumes: existing migration version `1200001`.
- Produces: migration `1200002` and table `novel_fetch_workshop_bodies`.

- [ ] **Step 1: Write the failing schema test**

Add assertions equivalent to:

```go
func TestNovelFetchWorkshopBodyMigration(t *testing.T) {
    migrations := NovelFetchWorkshopMigrations()
    if len(migrations) < 2 { t.Fatalf("expected v2 migration") }
    if migrations[1].Version != 1200002 { t.Fatalf("version=%d", migrations[1].Version) }
    joined := strings.Join(migrations[1].SQL, "\n")
    for _, want := range []string{
        "CREATE TABLE IF NOT EXISTS novel_fetch_workshop_bodies",
        "owner_username VARCHAR(191) NOT NULL",
        "book_id VARCHAR(191) NOT NULL",
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

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd backend
go test ./internal/storage -run 'TestNovelFetchWorkshopBodyMigration' -v
```

Expected: FAIL because migration `1200002` does not exist.

- [ ] **Step 3: Add migration `1200002`**

Create the body table with this contract:

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

Use callback checksum `novel-fetch-workshop-v2-bodies`.

- [ ] **Step 4: Run storage tests**

```bash
cd backend
go test ./internal/storage -v
```

Expected: PASS.

- [ ] **Step 5: Commit Go schema**

```bash
git add backend/internal/storage/novel_fetch_workshop_schema.go backend/internal/storage/novel_fetch_workshop_schema_test.go
git commit -m "feat(novel-fetch): add body object schema"
```

---

### Task 2: Add Body Codec and Store Interfaces

**Files:**
- Create: `backend/internal/novelfetchworkshop/body_codec.go`
- Create: `backend/internal/novelfetchworkshop/body_codec_test.go`
- Modify: `backend/internal/novelfetchworkshop/store.go`

**Interfaces:**
- Produces:
  - `type BodyRecord struct { BookID, VersionID, Content, ContentHash string; Revision uint64; CharCount int64; State, UpdatedAt string }`
  - `PutBody(ctx context.Context, owner string, body BodyRecord) (BodyRecord, error)`
  - `GetBody(ctx context.Context, owner, bookID, versionID string) (BodyRecord, error)`
  - `DeleteBody(ctx context.Context, owner, bookID, versionID string) (bool, error)`
  - `ListBodyRefs(ctx context.Context, owner, bookID string) ([]BodyRef, error)`

- [ ] **Step 1: Write codec RED tests**

```go
func TestBodyCodecRoundTrip(t *testing.T) {
    text := "第一章\n你好，世界。"
    encoded, hash, chars, err := encodeBody(text)
    if err != nil { t.Fatal(err) }
    if chars != int64(len([]rune(text))) { t.Fatalf("chars=%d", chars) }
    if len(hash) != 64 { t.Fatalf("hash=%q", hash) }
    decoded, err := decodeBody(encoded, "gzip")
    if err != nil { t.Fatal(err) }
    if decoded != text { t.Fatalf("decoded=%q", decoded) }
}
```

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run 'TestBodyCodecRoundTrip' -v
```

Expected: FAIL with missing codec symbols.

- [ ] **Step 3: Implement gzip + SHA-256 codec**

Rules:
- Hash the UTF-8 body bytes before compression.
- `CharCount` uses Unicode rune count, not byte count.
- Empty body is valid at codec level; API/store validation decides whether to persist it.
- Decode rejects unknown `content_encoding`.

- [ ] **Step 4: Extend `Store` and `MemoryStore`**

Keep task metadata methods. Add body methods and clone behavior. Store body records under owner→book→version. `DeleteDocuments` must keep existing semantics in S1; do not implicitly delete bodies until deletion semantics are migrated in a later task.

- [ ] **Step 5: Run package tests**

```bash
cd backend
go test ./internal/novelfetchworkshop -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/novelfetchworkshop/store.go backend/internal/novelfetchworkshop/body_codec.go backend/internal/novelfetchworkshop/body_codec_test.go
git commit -m "feat(novel-fetch): add body store contract"
```

---

### Task 3: Implement MySQL Body Persistence

**Files:**
- Modify: `backend/internal/novelfetchworkshop/mysql_store.go`
- Create: `backend/internal/novelfetchworkshop/mysql_store_body_test.go`

**Interfaces:**
- Consumes: Task 2 body interface.
- Produces: MySQL implementation using `novel_fetch_workshop_bodies`.

- [ ] **Step 1: Write SQL contract tests**

Use the repository's existing SQL mocking/testing pattern. Cover:
- insert body → gzip blob + hash + char count;
- update same `(owner, book, version)` increments revision;
- get body decodes gzip;
- body not found returns `ErrNotFound`;
- list refs never returns `Content`.

Core expected query behavior:

```sql
INSERT INTO novel_fetch_workshop_bodies(...)
VALUES(...)
ON DUPLICATE KEY UPDATE
  revision=revision+1,
  content_encoding=VALUES(content_encoding),
  content_blob=VALUES(content_blob),
  content_hash=VALUES(content_hash),
  char_count=VALUES(char_count),
  state=VALUES(state),
  updated_at=CURRENT_TIMESTAMP(6),
  last_needed_at=CURRENT_TIMESTAMP(6)
```

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run 'Body' -v
```

Expected: FAIL because MySQL body methods are missing.

- [ ] **Step 3: Implement methods**

Never store uncompressed full body in `document_json`. `ListBodyRefs` returns only:

```json
{
  "versionId": "ai3",
  "revision": 2,
  "contentHash": "...",
  "charCount": 123456,
  "state": "ready",
  "updatedAt": "..."
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend
go test ./internal/novelfetchworkshop ./internal/storage -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/novelfetchworkshop/mysql_store.go backend/internal/novelfetchworkshop/mysql_store_body_test.go
git commit -m "feat(novel-fetch): persist compressed body objects"
```

---

### Task 4: Add Dedicated Signed Body Bridge Endpoints

**Files:**
- Modify: `backend/internal/httpapi/novel_fetch_workshop.go`
- Modify: `backend/internal/httpapi/novel_fetch_workshop_test.go`

**Interfaces:**
- Produces:
  - `GET /api/novel-fetch-workshop/tasks/{bookId}/bodies`
  - `GET /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}`
  - `PUT /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}` body `{ "content": "...", "state": "ready" }`
  - `DELETE /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}`

- [ ] **Step 1: Add RED API round-trip test**

The test must use the existing signed bridge middleware, not bypass auth. Sequence:

```text
PUT body ai3 with Chinese text
→ 200 and hash/charCount metadata
GET body ai3
→ same exact text
GET bodies list
→ contains ai3 metadata but not text
DELETE body ai3
→ 200 deleted=true
GET body ai3
→ 404
```

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/httpapi -run 'NovelFetch.*Body' -v
```

Expected: FAIL/404 because routes do not exist.

- [ ] **Step 3: Implement endpoints**

Validation:
- reuse `novelFetchBookIDPattern` for `bookId`;
- `versionId` must match `^[A-Za-z0-9_.-]{1,64}$`;
- body request stays under existing `http.MaxBytesReader` limit in S1;
- list endpoint never returns `content`;
- bridge canonical signature automatically includes the new path exactly as existing middleware does.

- [ ] **Step 4: Preserve old task endpoints**

Do not remove existing `GET/PUT /tasks/{bookId}` yet. S1 Node migration needs a compatibility window.

- [ ] **Step 5: Run Go bridge tests and build**

```bash
cd backend
gofmt -w internal/novelfetchworkshop internal/httpapi internal/storage
go test ./internal/httpapi ./internal/novelfetchworkshop ./internal/storage -v
go build ./...
```

Expected: all PASS/build succeeds.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/httpapi/novel_fetch_workshop.go backend/internal/httpapi/novel_fetch_workshop_test.go
git commit -m "feat(novel-fetch): expose signed body bridge"
```

---

### Task 5: Migrate Node Workshop Adapter to Metadata + Bodies

**Files:**
- Modify: `lib/novel-fetch-workshop/mysql-store.js`
- Modify: `tests/novel-fetch-mysql-fetch-contract.test.js`
- Modify: `tests/novel-fetch-v2-task-list-bridge.test.js`
- Modify: `tests/novel-fetch-task-api.test.js`

**Interfaces:**
- Consumes: Task 4 body bridge endpoints.
- Produces internal Node helpers:
  - `readBody(bookId, versionId)` → text or `''` for not found where legacy callers expect empty.
  - `writeBody(bookId, versionId, content, state='ready')` → body metadata.
  - `listBodyRefs(bookId)` → metadata only.
  - `deleteBody(bookId, versionId)` → boolean.

- [ ] **Step 1: Write RED list contract**

Add an assertion that list payload does not contain full text:

```js
assert.equal('original' in task, false);
assert.equal('originalRaw' in task, false);
assert.equal('versions' in task, false);
assert.deepEqual(task.bodyVersions.sort(), ['ai1', 'ai3', 'original']);
```

- [ ] **Step 2: Write RED fetch persistence contract**

After `fetchOriginal(...)`, assert the adapter issues a dedicated body PUT for `original`, while task PUT contains metadata only. The task PUT body must not contain the fetched novel text.

- [ ] **Step 3: Verify RED**

```bash
node --test tests/novel-fetch-mysql-fetch-contract.test.js tests/novel-fetch-v2-task-list-bridge.test.js tests/novel-fetch-task-api.test.js
```

Expected: FAIL against legacy `meta + original + originalRaw + versions + logs` document writes.

- [ ] **Step 4: Split adapter reads/writes**

New task document shape in Node should be lightweight:

```js
{
  bookId,
  meta,
  bodyRefs: {
    original: { versionId: 'original', contentHash, charCount, revision, state },
    ai3: { versionId: 'ai3', contentHash, charCount, revision, state }
  },
  logs
}
```

Compatibility rules during S1:
- `getTask()` may reconstruct a legacy-looking in-memory `document` only for internal callers that truly need it.
- `listTasks()` must never fetch body text.
- `readVersionText(username, bookId, 'original')` reads body version `original`.
- `readVersionText(..., 'ai3')` reads body version `ai3`.
- Stop persisting `originalRaw`; after fetch, normalize once and store only `original` body. Keep raw character count/hash only if needed for diagnostics.

- [ ] **Step 5: Keep AI writer behavior compatible**

Where existing methods previously mutated `document.versions.aiN`, route the full text to `writeBody(bookId, 'aiN', text)` and update only version metadata/status in the task document.

- [ ] **Step 6: Run focused Node tests**

```bash
node --test tests/novel-fetch-mysql-fetch-contract.test.js tests/novel-fetch-v2-task-list-bridge.test.js tests/novel-fetch-task-api.test.js tests/novel-fetch-runner.test.js tests/novel-fetch-runner-advanced.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Node adapter**

```bash
git add lib/novel-fetch-workshop/mysql-store.js tests/novel-fetch-mysql-fetch-contract.test.js tests/novel-fetch-v2-task-list-bridge.test.js tests/novel-fetch-task-api.test.js
git commit -m "feat(novel-fetch): separate history metadata from bodies"
```

---

### Task 6: Preserve Existing 121 Upload While Reading New Body Store

**Files:**
- Modify: `routes/novel-fetch-upload.js` only if the existing `readVersionText()` abstraction is insufficient.
- Modify: `tests/novel-fetch-upload-browser-worker.test.js`
- Modify: `tests/novel-fetch-upload-source-contract.test.js`

**Interfaces:**
- Consumes: Node adapter `readVersionText` from Task 5.
- Produces: unchanged 121 upload payload contract.

- [ ] **Step 1: Add regression test**

Given `ai3` body exists only in Body Store and no real TXT exists, upload must still construct:

```text
multipart/form-data
field: files[]
filename: <bookId>.txt
Content-Type: text/plain
body bytes: UTF-8 AI3 content
```

- [ ] **Step 2: Run and verify RED if needed**

```bash
node --test tests/novel-fetch-upload-browser-worker.test.js tests/novel-fetch-upload-source-contract.test.js
```

If the test is already GREEN through `readVersionText`, do not make a production-code change merely to create churn; keep the regression test and commit it.

- [ ] **Step 3: Minimal compatibility change only if required**

The route must not know SQL/body-table details. It should request selected version text through the store abstraction, then keep using `target.buildTargetUploadFilename(bookId)` and existing multipart construction.

- [ ] **Step 4: Run upload tests**

```bash
node --test tests/novel-fetch-upload-browser-worker.test.js tests/novel-fetch-upload-source-contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/novel-fetch-upload.js tests/novel-fetch-upload-browser-worker.test.js tests/novel-fetch-upload-source-contract.test.js
git commit -m "test(novel-fetch): preserve 121 upload from body store"
```

---

### Task 7: Add Compatibility Migration for Existing Stored Documents

**Files:**
- Create: `backend/internal/novelfetchworkshop/legacy_document_migration.go`
- Create: `backend/internal/novelfetchworkshop/legacy_document_migration_test.go`
- Modify: `backend/internal/novelfetchworkshop/mysql_store.go`

**Interfaces:**
- Produces: idempotent lazy migration `MigrateLegacyDocumentBodies(ctx, owner, bookID)`.

- [ ] **Step 1: Write RED migration tests**

Cover a legacy document containing:

```json
{
  "original": "原文",
  "originalRaw": "原始原文",
  "versions": {"ai1": "AI1", "ai3": "AI3"}
}
```

Expected after migration:
- body `original` contains normalized `original` (not a second permanent `originalRaw` body);
- bodies `ai1`, `ai3` exist;
- document JSON no longer contains full `original`, `originalRaw`, or full version strings;
- running migration twice does not create extra revisions or change content hashes.

- [ ] **Step 2: Verify RED**

```bash
cd backend
go test ./internal/novelfetchworkshop -run 'LegacyDocument' -v
```

Expected: FAIL because migration helper is missing.

- [ ] **Step 3: Implement transactionally**

Within one DB transaction:
1. lock the legacy document row;
2. parse old body fields;
3. insert missing body rows only;
4. replace full text fields with body refs/availability metadata;
5. commit.

Do not delete the task/history row.

- [ ] **Step 4: Wire lazy migration on task detail write/read boundary**

Run it when an old-format document is encountered. Do not perform a giant blocking full-table migration during application startup in S1.

- [ ] **Step 5: Run package tests**

```bash
cd backend
go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -v
go build ./...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/novelfetchworkshop/legacy_document_migration.go backend/internal/novelfetchworkshop/legacy_document_migration_test.go backend/internal/novelfetchworkshop/mysql_store.go
git commit -m "feat(novel-fetch): migrate legacy full-text documents"
```

---

### Task 8: End-to-End S1 Verification and Review Gate

**Files:**
- No production files unless a verified defect is found.
- Add focused integration test file if needed: `tests/novel-fetch-body-history-contract.test.js`.

**Interfaces:**
- Produces: exact verified Node SHA and exact verified Go SHA for S2 to consume.

- [ ] **Step 1: Run Node focused suite**

```bash
node --test \
  tests/novel-fetch-mysql-fetch-contract.test.js \
  tests/novel-fetch-v2-task-list-bridge.test.js \
  tests/novel-fetch-task-api.test.js \
  tests/novel-fetch-runner.test.js \
  tests/novel-fetch-runner-advanced.test.js \
  tests/novel-fetch-upload-browser-worker.test.js \
  tests/novel-fetch-upload-source-contract.test.js
```

Expected: PASS.

- [ ] **Step 2: Run broader Node novel-fetch suite**

```bash
node --test tests/novel-fetch-*.test.js
```

Expected: PASS, or document pre-existing unrelated failures with exact test names; no new failure is accepted.

- [ ] **Step 3: Run Go tests/build**

```bash
cd backend
gofmt -w internal/novelfetchworkshop internal/httpapi internal/storage
go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -v
go build ./...
```

Expected: PASS.

- [ ] **Step 4: Verify the key data property manually/in integration test**

For one book with `original + ai1 + ai3`:
- history/task-list response contains no full text;
- three body rows/objects exist;
- deleting a body object does not delete task metadata;
- old server-side 121 upload can still read selected body text and upload with `<bookId>.txt`.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review`. Review must explicitly check:
- no hidden full-text duplication remains in task JSON;
- body/list APIs do not leak full content;
- migration is idempotent;
- existing 121 upload remains compatible.

- [ ] **Step 6: Record handoff SHAs**

Do not merge into production. Report:

```text
Node S1 branch: <branch>
Node S1 exact SHA: <sha>
Go S1 branch: <branch>
Go S1 exact SHA: <sha>
```

These become the only accepted baselines for S2.

---

## S1 Exit Criteria

S1 is complete only when all are true:

1. Full original/AI bodies are stored outside long-lived task/history JSON.
2. History/list requests do not retrieve full body content.
3. `originalRaw` is not kept as a permanent duplicate full text.
4. Existing books can migrate safely and idempotently.
5. Existing server 121 upload still works from the new body store without a real TXT file.
6. No automatic body deletion is enabled yet.
7. Node and Go exact SHAs have passed their focused suites and build checks.

## Next Plans (separate reviewable slices)

After S1 passes, write/execute separate plans in this order:

1. **S2 Local Executor Body Sync & Export** — device pairing, local internal body store, cloud→local sync, user download/export, exported-file override tracking.
2. **S3 Local 121 Login & Upload** — web login entry preserved, local headless Chromium/session, manual verification fallback, local body upload.
3. **S4 Multi-Device Lease & Transfer** — primary/backup routing, leases, duplicate-upload protection, 24-hour explicit relay.
4. **S5 Cleanup Settings & Capacity Guard** — navigation settings, 1–30 day retention/default 7, local+cloud cleanup, manual history clear, safe capacity cleanup.
5. **S6 Server Browser Worker Retirement** — only after S3–S5 production-equivalent verification; remove the server worker from release packaging.
