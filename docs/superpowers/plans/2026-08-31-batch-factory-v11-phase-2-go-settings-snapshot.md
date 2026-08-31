# Batch Factory V11 Phase 2 Go Foundation And Settings/Snapshot Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This is the current Go/Foundation workstream; it does not modify the React/Ant Design worktree.

**Goal:** 从批准的 V78 源码恢复 Go V11 Slice 1，建立 checksum-safe MySQL 迁移、签名 Node 代理、Go-owned Batch/Book/VIDEO 详情、Settings、Config Snapshot、catalog 和 sparse override 契约。

**Architecture:** `backend/` 从固定 Go 来源 commit 选择性恢复，再通过 additive migrations 扩展。Go 在 HMAC bridge 认证后暴露 owner-scoped HTTP routes。Node 文件只转发现有登录态身份和 opaque request body。MemoryStore 和 MySQLStore 输出同一个公共 JSON contract，避免测试掩盖持久化差异。

**Tech Stack:** Go 1.23、`database/sql`、MySQL 8.4、`net/http`、Node 24/Express 5、HMAC-SHA256、Node test runner。

## Global Constraints

- Base branch: `f4689d761229016b81180f7ad0d4ffb956fc3399`; V78 source: `483faed8d654e452f6079fc1ef40b74db3a13d1c`; Go source: `8aca2668b332d37f1c7c64030b17220621d74799`.
- The restored Go tree is a selective file restore, never a merge. Every restored or changed file is listed in `docs/batch-factory/v11-source-provenance.tsv` with its original blob SHA.
- Existing migration versions/checksums are immutable. This phase owns Migration `1100004`; Phase 3 owns `1100005`, Phase 4 owns `1100006`, and the Phase 1 import audit owns `1100007`. No phase may reuse another phase's version.
- `GET /api/batch-factory/v11/capabilities` is the only source for UI unlock decisions. Only `batch.read`, `batch.create`, `settings.edit`, `snapshot.read`, and `override.edit` may be available in this phase.
- Go validates owner, scope, catalog IDs and revisions. Node never reads V11 JSON fields, calculates inheritance, or writes a second copy.
- Settings patches preserve `false`, empty string, and `0`; snapshots are read back by ID; Book/VIDEO overrides survive parent changes and are never silently deleted.
- System presets are a Go-owned read-only catalog; personal prompts and drafts are Go/MySQL owner-scoped records. There is no new Node Prompt rule.
- The phase does not start Director, Final Prompt Compiler, Production, Status, Merge, 121 or Yadi, and does not touch `:3000` or formal volumes.

## File Structure

- Restore only these Go runtime files from `8aca2668b332d37f1c7c64030b17220621d74799`: `backend/go.mod`, `backend/go.sum`, `backend/Dockerfile`, `backend/cmd/qiantie/main.go`, `backend/internal/app/app.go`, `backend/internal/config/config.go`, `backend/internal/batchfactoryv11/types.go`, `intakes.go`, `settings.go`, `config_versions.go`, `memory_store.go`, `mysql_store.go`, `backend/internal/httpapi/router.go`, `batch_factory_v11_auth.go`, `batch_factory_v11_capabilities.go`, `batch_factory_v11_slice1.go`, `backend/internal/storage/migrations.go`, `batch_factory_v11_schema.go`, and `bridge_users.go`.
- Restore only these source tests from the same commit: `backend/internal/batchfactoryv11/config_version_contract_test.go`, `settings_readback_test.go`, `settings_test.go`, `store_test.go`, `backend/internal/httpapi/batch_factory_v11_capabilities_test.go`, `batch_factory_v11_config_version_test.go`, `batch_factory_v11_slice1_test.go`, `backend/internal/storage/batch_factory_v11_config_version_test.go`, `batch_factory_v11_schema_test.go`, `migrations_mysql84_test.go`, and `migrations_test.go`.
- Create: `docs/batch-factory/v11-source-provenance.tsv`, `scripts/verify-v11-source-baseline.sh`.
- Modify/create: `backend/internal/storage/migrations.go`, `backend/internal/storage/batch_factory_v11_schema.go`, and their tests.
- Modify/create: `backend/internal/batchfactoryv11/types.go`, `settings.go`, `config_versions.go`, `memory_store.go`, `mysql_store.go`, `detail_contract_test.go`, `settings_readback_test.go`, `change_impact_test.go`, and catalog tests.
- Create: `backend/internal/httpapi/batch_factory_v11_catalog_test.go`, `batch_factory_v11_detail_contract_test.go`, and snapshot readback tests.
- Restore from fixed Go source: `lib/batch-factory-v11/go-proxy.js`, `routes/batch-factory-v11.js`, `test/batch-factory-v11-proxy.test.js`; modify `app.js` only to mount the router.

### Task 1: Establish the clean Go source boundary

**Interfaces:**

- `scripts/verify-v11-source-baseline.sh` exits non-zero unless the approved design commit is an ancestor, the recovery branch exists, and only declared provenance files are changed.
- The imported package test command is `go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1`.

- [ ] **Step 1: Write and run the failing source guard**

Create the guard with exact SHA checks and a status allowlist for the two Task 1 files. Run:

~~~bash
bash scripts/verify-v11-source-baseline.sh
~~~

Expected: FAIL before the implementation worktree and provenance ledger are prepared.

- [ ] **Step 2: Create the implementation worktree from the approved design**

Run in a separate checkout:

~~~bash
git switch -c feat/batch-factory-v78-selective-v11 f4689d761229016b81180f7ad0d4ffb956fc3399
git restore --source=8aca2668b332d37f1c7c64030b17220621d74799 -- \
  backend/go.mod \
  backend/go.sum \
  backend/Dockerfile \
  backend/cmd/qiantie/main.go \
  backend/internal/app/app.go \
  backend/internal/config/config.go \
  backend/internal/batchfactoryv11/types.go \
  backend/internal/batchfactoryv11/intakes.go \
  backend/internal/batchfactoryv11/settings.go \
  backend/internal/batchfactoryv11/config_versions.go \
  backend/internal/batchfactoryv11/memory_store.go \
  backend/internal/batchfactoryv11/mysql_store.go \
  backend/internal/httpapi/router.go \
  backend/internal/httpapi/batch_factory_v11_auth.go \
  backend/internal/httpapi/batch_factory_v11_capabilities.go \
  backend/internal/httpapi/batch_factory_v11_slice1.go \
  backend/internal/storage/migrations.go \
  backend/internal/storage/batch_factory_v11_schema.go \
  backend/internal/storage/bridge_users.go \
  backend/internal/batchfactoryv11/config_version_contract_test.go \
  backend/internal/batchfactoryv11/settings_readback_test.go \
  backend/internal/batchfactoryv11/settings_test.go \
  backend/internal/batchfactoryv11/store_test.go \
  backend/internal/httpapi/batch_factory_v11_capabilities_test.go \
  backend/internal/httpapi/batch_factory_v11_config_version_test.go \
  backend/internal/httpapi/batch_factory_v11_slice1_test.go \
  backend/internal/storage/batch_factory_v11_config_version_test.go \
  backend/internal/storage/batch_factory_v11_schema_test.go \
  backend/internal/storage/migrations_mysql84_test.go \
  backend/internal/storage/migrations_test.go \
  lib/batch-factory-v11/go-proxy.js \
  routes/batch-factory-v11.js \
  test/batch-factory-v11-proxy.test.js
~~~

Before committing, remove any restored Go file that is not listed in the provenance ledger. This command is intentionally limited to the V11 packages and their direct bootstrap dependencies; it must not restore historical Shuihuo, account, production, 121, or Yadi packages.

Do not reset, clean, or alter the design worktree.

- [ ] **Step 3: Run the unmodified imported Go tests**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1
~~~

Expected: PASS. If it fails, record the exact package, test, and output in the handoff and stop; do not patch domain behavior in this step.

- [ ] **Step 4: Record provenance by blob SHA**

For every restored file, run:

~~~bash
git rev-parse 8aca2668b332d37f1c7c64030b17220621d74799:path/to/file
~~~

Write one TSV row containing `file`, `source_branch`, `source_commit`, `source_blob_sha`, `purpose`, and `transformed`. A transformed row states the exact import or capability-name change.

- [ ] **Step 5: Run the guard and commit**

~~~bash
bash scripts/verify-v11-source-baseline.sh
git add docs/batch-factory/v11-source-provenance.tsv scripts/verify-v11-source-baseline.sh
git commit -m "chore(batch-v11): establish Go source boundary"
~~~

Stop if the commit contains frontend, production data, Docker volume, or provider credential changes.

### Task 2: Confirm checksum behavior and MySQL 8.4 migration safety

**Interfaces:**

- Existing `storage.Migration{Version, SQL, CallbackChecksum}` and `storage.RunMigrations` remain the checksum authority.
- This phase registers only Migration `1100004`; later migrations are reserved for `1100005`, `1100006`, and `1100007` as documented above. All are additive and strictly increasing.
- `scripts/verify-v11-mysql84.sh` accepts only a disposable DSN and emits redacted logs.

- [ ] **Step 1: Inspect the actual migration numbering before editing**

Run:

~~~bash
rg -n 'Version:|migration.?27|027_|MEDIUMTEXT|schema_migrations|checksum' backend/internal/storage backend
~~~

If a migration 27 is present, record its exact file and checksum path. If no migration 27 exists in the selected V11 tree, record that fact in phase evidence and do not invent one. In either case, do not edit a migration statement before the checksum mechanism is identified.

- [ ] **Step 2: Write failing checksum and matrix tests**

Extend `backend/internal/storage/migrations_test.go` with a local `memoryLedger` that implements `RecordedChecksum` and `Record`, then add these exact assertions:

~~~go
func TestRunMigrationsRejectsRecordedChecksumMismatch(t *testing.T) {
    ledger := &memoryLedger{checksums: map[int]string{1100003: "wrong-checksum"}}
    err := RunMigrationPlan(context.Background(), ledger, V11Migrations(), func(context.Context, Migration) error { return nil })
    if err == nil || !strings.Contains(err.Error(), "migration 1100003 checksum mismatch") {
        t.Fatalf("expected checksum mismatch, got %v", err)
    }
}

func TestMigrationVersionsAreStrictlyIncreasing(t *testing.T) {
    migrations := V11Migrations()
    for i := 1; i < len(migrations); i++ {
        if migrations[i-1].Version >= migrations[i].Version {
            t.Fatalf("versions are not strictly increasing: %d then %d", migrations[i-1].Version, migrations[i].Version)
        }
    }
}
~~~

Extend `backend/internal/storage/migrations_mysql84_test.go` with `mysql84DSN(t) string`. It reads only `QIANTIE_TEST_MYSQL84_DSN`; when that variable is absent it calls `t.Skip("QIANTIE_TEST_MYSQL84_DSN is required for MySQL 8.4 verification")`. Use that DSN to create a database whose name begins `bfv11_test_`, then implement these four cases:

~~~go
func TestMySQL84EmptyToLatest(t *testing.T) { runFreshMigrationCase(t, "empty", nil) }
func TestMySQL84SchemaOneToLatest(t *testing.T) { runFreshMigrationCase(t, "schema_one", seedSchemaVersionOne) }
func TestMySQL84Schema26ToLatest(t *testing.T) { runFreshMigrationCase(t, "schema_twenty_six", seedSchemaVersionTwentySix) }
func TestMySQL84RepeatStartup(t *testing.T) { runFreshMigrationCase(t, "repeat", func(ctx context.Context, db *sql.DB) error { if err := RunMigrations(ctx, db, V11Migrations()); err != nil { return err }; return RunMigrations(ctx, db, V11Migrations()) }) }
~~~

`seedSchemaVersionOne` and `seedSchemaVersionTwentySix` create only the legacy `schema_migrations` ledger rows required by the test and then call `RunMigrations`; they never mount or name a formal volume. A skipped MySQL test is recorded as skipped, not as a passing migration result.

- [ ] **Step 3: Implement only additive checksum-safe changes**

Keep the existing SHA-256 canonicalization and callback checksum contract. Add checksum ledger compatibility or a MySQL 8.4 text-column repair in Migration `1100004`. A legacy empty checksum may be backfilled only once, with an audit row containing the verified expected checksum and operator run ID. Do not rewrite `1100001`, `1100002`, or `1100003`.

- [ ] **Step 4: Run the four fresh-volume cases**

Use a unique Docker Compose project and MySQL 8.4 volume per case. Run:

~~~bash
go -C backend test -tags=mysql84 ./internal/storage -run 'TestMySQL84(EmptyToLatest|SchemaOneToLatest|Schema26ToLatest|RepeatStartup)' -count=1
go -C backend test ./internal/storage -run 'TestRunMigrationsRejectsRecordedChecksumMismatch|TestMigrationVersionsAreStrictlyIncreasing' -count=1
~~~

Expected: valid paths PASS, checksum mismatch fails closed, and no formal volume name appears in logs.

- [ ] **Step 5: Commit migration integrity**

~~~bash
git add backend/internal/storage
git commit -m "fix(batch-v11): make V11 migrations checksum safe"
~~~

### Task 3: Complete the Go Batch/Book/VIDEO and Settings/Snapshot domain

**Interfaces:**

- Existing Store methods remain: `CreateIntake`, `GetIntake`, `CreateBatchFromIntake`, `CreateBatch`, `ListBatches`, `GetBatch`, `SaveSettings`, `ConfigVersions`, `ChangeImpact`, `ListPrompts`, `CreatePrompt`, `GetDraft`, `SaveDraft`.
- Add `GetSnapshot(ctx, owner, batchID, snapshotID) (ConfigSnapshot, error)` and expose the same result from MemoryStore and MySQLStore.
- `SettingsState{Patch, Revision, Snapshot, Compatibility}` is embedded in Batch, Book and Video detail responses.

- [ ] **Step 1: Write failing detail and readback tests**

Add `backend/internal/batchfactoryv11/detail_contract_test.go` and extend `settings_readback_test.go` with concrete memory-store tests. The fixture is one owner, one Batch, one Book, and one VIDEO.

~~~go
func TestSparsePatchPreservesFalseEmptyAndZero(t *testing.T) {
    store, batch := newSettingsFixture(t)
    saved, err := store.SaveSettings(context.Background(), "owner-a", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
        ExpectedRevision: batch.Revision,
        Patch: SettingsPatch{
            "injectCharacterPrompt": json.RawMessage("false"),
            "negativePrompt":         json.RawMessage(`""`),
            "exactDuration":           json.RawMessage("0"),
        },
    })
    if err != nil { t.Fatal(err) }
    if string(saved.Patch["injectCharacterPrompt"]) != "false" || string(saved.Patch["negativePrompt"]) != `""` || string(saved.Patch["exactDuration"]) != "0" {
        t.Fatalf("sparse values changed: %#v", saved.Patch)
    }
}

func TestParentSavePreservesBookAndVideoPatches(t *testing.T) {
    store, batch := newSettingsFixture(t)
    book := batch.Books[0]
    video := book.Videos[0]
    savePatch(t, store, ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID}, book.Revision, SettingsPatch{"aspectRatio": json.RawMessage(`"16:9"`)})
    savePatch(t, store, ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID}, video.Revision, SettingsPatch{"fixedSingleVideo": json.RawMessage("true")})
    savePatch(t, store, ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, batch.Revision, SettingsPatch{"mode": json.RawMessage(`"viral"`)})
    if got := string(store.DebugPatch(ScopeRef{Kind: ScopeBook, BatchID: batch.ID, BookID: book.ID})["aspectRatio"]); got != `"16:9"` { t.Fatalf("book override lost: %s", got) }
    if got := string(store.DebugPatch(ScopeRef{Kind: ScopeVideo, BatchID: batch.ID, BookID: book.ID, VideoID: video.ID})["fixedSingleVideo"]); got != "true" { t.Fatalf("video override lost: %s", got) }
}
~~~

`TestBatchDetailCarriesWorkbenchFields` asserts non-empty JSON keys `mode`, `status`, `platform`, `assets`, `hook`, `directorRevision`, `videoModel`, `mediaUrl`, and `mergedUrl` after a save/load cycle. `TestGetBatchReadsSettingsStateForEveryScope` asserts each scope has a distinct revision and effective snapshot. `TestGetSnapshotReadsImmutableEffectivePatch` saves a batch patch, records the returned snapshot ID, saves a later patch, then confirms the first snapshot still contains the original JSON bytes.

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(BatchDetail|GetBatchReads|GetSnapshot|SparsePatch|ParentSave)' -count=1
~~~

Expected: FAIL because current detail types and snapshot readback are incomplete.

- [ ] **Step 2: Add explicit domain fields without changing legacy tables**

Extend `types.go` with `AssetRef`, `AssetBundle`, `ModelSnapshot`, `DirectorRevision`, `SettingsState`, `CompatibilityNote`, `Mode`, `Status`, `Platform`, `VideoModel`, `MediaURL`, and `MergedURL` fields. Keep generated internal IDs distinct from an explicitly supplied public BookID and VIDEO ID. Store additive fields in V11 JSON/columns through a new migration version.

- [ ] **Step 3: Make MemoryStore and MySQLStore symmetric**

Update `CreateBatch`, `CreateBatchFromIntake`, `ListBatches`, `GetBatch`, `SaveSettings`, and snapshot loading so both stores emit the same JSON shape. `ApplySparseUpdate` uses key presence, not truthiness. `ResolveSettings` applies layers in system -> batch -> book -> video order. `RestoreKeys` deletes only named keys.

When a setting changes, retain all child patch rows. `ChangeImpact` returns changed keys, affected counts, InvalidatesDirector, PreservesOverrides, and compatibility entries. A VIDEO identity change leaves its old patch byte-for-byte intact and marks the entry orphaned or incompatible.

- [ ] **Step 4: Add config-version and catalog authority tests**

Add `backend/internal/batchfactoryv11/change_impact_test.go` and `backend/internal/httpapi/batch_factory_v11_catalog_test.go`. Cover model/version/max-duration canonicalization, owner-visible config versions, cross-owner 404, invalid model IDs, and Director invalidation for model, mode, config version, aspect ratio, duration strategy and fixed-single-VIDEO changes.

- [ ] **Step 5: Run the complete Go domain suite and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -count=1
git add backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): persist V11 detail settings and snapshots"
~~~

### Task 4: Expose owner-scoped Go HTTP contracts

**Files:** `backend/internal/httpapi/batch_factory_v11_slice1.go`, `router.go`, `batch_factory_v11_capabilities.go`, and their contract tests.

- [ ] **Step 1: Write failing route tests**

Cover unsigned 401, cross-owner 404, stale revision 409 with the newest revision, catalog response, snapshot readback, and these routes:

~~~text
GET  /api/batch-factory/v11/capabilities
POST /api/batch-factory/v11/intakes/novel-fetch
GET  /api/batch-factory/v11/intakes/{intakeId}
POST /api/batch-factory/v11/intakes/{intakeId}/batches
GET/POST /api/batch-factory/v11/batches
GET  /api/batch-factory/v11/batches/{batchId}
PUT  /api/batch-factory/v11/batches/{batchId}/settings
PUT  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/override
PUT  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/override
GET  /api/batch-factory/v11/batches/{batchId}/snapshots/{snapshotId}
GET  /api/batch-factory/v11/config-versions
GET  /api/batch-factory/v11/catalog/video-models
POST /api/batch-factory/v11/batches/{batchId}/change-impact
GET/POST /api/batch-factory/v11/prompts
GET/PUT /api/batch-factory/v11/drafts
~~~

Run:

~~~bash
go -C backend test ./internal/httpapi -run 'TestV11|TestSnapshot|TestCrossOwner|TestRevision' -count=1
~~~

Expected: FAIL until handlers and routes are registered.

- [ ] **Step 2: Implement handlers as thin Go calls**

Handlers decode bounded JSON, derive owner only from signed bridge context, call the Store/catalog service, and return documented status/body. They do not call legacy Node stores or accept owner IDs from request bodies. Capability response includes all keys, with only five Slice 1 keys available.

- [ ] **Step 3: Verify the response contracts**

~~~bash
go -C backend test ./internal/httpapi ./internal/batchfactoryv11 ./internal/storage -count=1
~~~

Expected: PASS with stable zero values for optional detail fields, exact snapshot readback, and no `production.run` key.

- [ ] **Step 4: Commit the Go API slice**

~~~bash
git add backend/internal/httpapi backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): expose owner-scoped settings snapshot API"
~~~

### Task 5: Add the transparent Node session/HMAC proxy

**Files:**

- `lib/batch-factory-v11/go-proxy.js` (restore and extend only transport behavior)
- `routes/batch-factory-v11.js` (restore and mount)
- `app.js` (route registration before legacy Batch Factory routes)
- `test/batch-factory-v11-proxy.test.js`

- [ ] **Step 1: Write failing proxy tests at the real paths**

Use a local `http.createServer` capture fixture in `test/batch-factory-v11-proxy.test.js`. Test signed pathname/method, opaque JSON body preservation including false, empty string, and zero, upstream status/body/content type passthrough, unauthenticated 401, blocked method, missing target 503, timeout 504, and absence of body/credential logging.

Run:

~~~bash
node --test test/batch-factory-v11-proxy.test.js
~~~

Expected: FAIL until the router is mounted in the V78 app.

- [ ] **Step 2: Implement transport-only behavior**

Use existing `createSignedBridgeHeaders` and canonical HMAC payload. Read identity from `req.username` and `req.auth.account`; never trust a body username. Forward `req.originalUrl`, method, content type and opaque serialized body to `QIANTIE_GO_BASE_URL`. Abort after 10 seconds, return upstream status/body unchanged, and redact all error logs.

- [ ] **Step 3: Mount and run legacy regressions**

Mount `createBatchFactoryV11Router` at `/api/batch-factory/v11` before legacy `/api/batch-factory` routers. The proxy must never import `lib/batch-factory/store.js`.

~~~bash
node --test test/batch-factory-v11-proxy.test.js test/batch-factory.test.js test/batch-factory-current-mainline-contract.test.js
~~~

Expected: PASS; legacy responses remain unchanged.

- [ ] **Step 4: Commit the boundary**

~~~bash
git add app.js lib/batch-factory-v11 routes/batch-factory-v11.js test/batch-factory-v11-proxy.test.js
git commit -m "feat(batch-v11): add transparent authenticated proxy"
~~~

## Phase Gate

- [ ] `go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1` passes.
- [ ] Fresh MySQL 8.4 empty/schema-one/schema-26/repeat matrix and checksum mismatch test have evidence.
- [ ] Signed proxy tests pass at `test/batch-factory-v11-proxy.test.js`; no Node V11 business rule is present.
- [ ] Provenance TSV has a real blob SHA for every restored file.
- [ ] A clean worktree from the phase commit can build `backend/Dockerfile`; no frontend or :3000 mutation occurred.

Stop here and hand the full phase SHA to the parallel UI workstream. Do not begin Phase 3 until this gate is reviewed.
