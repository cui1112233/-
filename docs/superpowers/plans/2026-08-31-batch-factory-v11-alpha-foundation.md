# Batch Factory V11 Alpha Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Go V11 runtime, signed Node session proxy, checksum-safe MySQL migration path, capability API, and Alpha release/rollback evidence before any V11 user action is published.

**Architecture:** Rebuild a narrow Go platform runtime in the recovered V78 repository using the historical Go branch only as provenance-checked reference. Node forwards an authenticated request without interpreting V11 data. A capability API starts with every workflow action unavailable; Slice 1 changes only the capabilities backed by real Go persistence.

**Worktree ownership:** This plan is executed in this worktree. It covers
Foundation only and does not implement the parallel V78/V11 React/Ant Design
selective-migration workstream. Frontend commands below are verification
inputs only; no frontend source, route, CSS, or browser client file may be
changed here.

**Tech Stack:** Go 1.23, chi v5, MySQL 8.4, Node 24/Express 5, React 18/Vite 5, Docker Compose, shell release scripts.

## Global Constraints

- Baseline: `recovery/production-v78.3.0.3-source@483faed8d654e452f6079fc1ef40b74db3a13d1c`.
- Browser API: `/api/batch-factory/v11/*`; Go is the only V11 business owner.
- Node may authenticate/sign/proxy only; it must not normalize V11 requests or persist V11 state.
- Do not merge 08/09/10 history. Record every selectively reused file in `docs/batch-factory/v11-provenance.tsv`.
- Migration checks run on fresh MySQL 8.4 volumes. No test process connects to production MySQL, production volumes, or provider credentials.
- Do not deploy this foundation alone to `:3000`; Slice 1 is the first user-visible Alpha release.

---

## File Structure

- Create: `backend/go.mod`, `backend/go.sum`, `backend/Dockerfile`, `backend/cmd/qiantie/main.go` - narrow Go service entry point.
- Create: `backend/internal/app/app.go`, `backend/internal/config/config.go` - dependency wiring and non-secret configuration parsing.
- Create: `backend/internal/httpapi/router.go`, `backend/internal/httpapi/batch_factory_v11_auth.go`, `backend/internal/httpapi/batch_factory_v11_capabilities.go` - signed bridge auth and V11 capability route.
- Create: `backend/internal/storage/migrations.go`, `backend/internal/storage/migrations_test.go` - checksum-ledger migration runner.
- Create: `backend/internal/storage/batch_factory_v11_schema.go`, `backend/internal/storage/batch_factory_v11_schema_test.go` - V11 schema registration with no feature records yet.
- Create: `lib/batch-factory-v11/go-proxy.js`, `routes/batch-factory-v11.js`, `test/batch-factory-v11-proxy.test.js` - Node session proxy contract.
- Modify: `app.js` - mount `/api/batch-factory/v11` before legacy `/api/batch-factory` routes.
- Create: `scripts/batch-factory-v11-alpha-release.sh`, `scripts/batch-factory-v11-alpha-rollback.sh`, `test/batch-factory-v11-alpha-release.test.js` - manifest, backup, immutable image, smoke, and rollback workflow.
- Create: `docs/batch-factory/v11-provenance.tsv` - immutable source provenance ledger.

### Task 1: Rebuild the minimal Go service and signed V11 boundary

**Files:**
- Create: `backend/go.mod`, `backend/cmd/qiantie/main.go`, `backend/internal/app/app.go`, `backend/internal/config/config.go`
- Create: `backend/internal/httpapi/router.go`, `backend/internal/httpapi/batch_factory_v11_auth.go`, `backend/internal/httpapi/batch_factory_v11_capabilities.go`
- Test: `backend/internal/httpapi/batch_factory_v11_capabilities_test.go`

**Interfaces:**
- Consumes: `QIANTIE_MYSQL_DSN`, `QIANTIE_BRIDGE_SECRET`, and non-secret `QIANTIE_BATCH_FACTORY_V11_*` feature settings.
- Produces: `GET /api/batch-factory/v11/capabilities` behind signed bridge authentication.
- Response type: `map[string]Capability`, where `Capability` is `{Available bool \`json:"available"\`; Reason string \`json:"reason,omitempty"\`}`.

- [ ] **Step 1: Write the failing Go HTTP tests for bridge authentication and default capability state**

```go
func TestV11CapabilitiesRejectUnsignedRequest(t *testing.T) {
    response := request(api.Router(), http.MethodGet, "/api/batch-factory/v11/capabilities", nil)
    if response.Code != http.StatusUnauthorized { t.Fatalf("got %d", response.Code) }
}

func TestV11CapabilitiesAreFalseBeforeSliceOne(t *testing.T) {
    response := signedRequest(api.Router(), http.MethodGet, "/api/batch-factory/v11/capabilities", "alpha-user")
    var got map[string]Capability
    decodeJSON(t, response, &got)
    if got["settings.edit"].Available { t.Fatal("settings must not be available") }
}
```

- [ ] **Step 2: Run the focused test and confirm it fails because the V11 router does not exist**

Run: `cd backend && go test ./internal/httpapi -run 'TestV11Capabilities' -count=1`

Expected: FAIL with missing V11 route or package symbols.

- [ ] **Step 3: Implement the minimal Go service and signed bridge middleware**

Use the historical `origin/10-batch-factory-go-api-migration` Go runtime only
to understand package boundaries. Rebuild the narrow V11 route in the new
`backend` tree. Require all of these headers: `X-Qiantie-Username`,
`X-Qiantie-Is-Owner`, `X-Qiantie-Issued-At`, and `X-Qiantie-Signature`. Verify
the HMAC over `username + issuedAt + isOwner + method + pathname`, reject a
clock skew beyond five minutes, and call the Go user store to resolve/create
the bridge user before handing a request to V11 code. Do not accept a user ID
from the browser.

```go
type Capability struct {
    Available bool   `json:"available"`
    Reason    string `json:"reason,omitempty"`
}

func defaultV11Capabilities() map[string]Capability {
    return map[string]Capability{
        "batch.read": {Reason: "V11 settings slice not released"},
        "settings.edit": {Reason: "V11 settings slice not released"},
        "director.run": {Reason: "Director slice not released"},
        "production.submit": {Reason: "Production slice not released"},
        "merge.run": {Reason: "Merge slice not released"},
        "publish.121": {Reason: "121 is not enabled"},
        "publish.yadi": {Reason: "Yadi is not enabled"},
    }
}
```

- [ ] **Step 4: Run the focused Go route tests and the health test**

Run: `cd backend && go test ./internal/httpapi -run 'TestV11Capabilities|TestHealth' -count=1`

Expected: PASS; unsigned and expired signatures receive `401`, signed requests
receive capability records with no available mutation capability.

- [ ] **Step 5: Record source provenance and commit the boundary**

Add the exact historical source commit/blob IDs used as reference to
`docs/batch-factory/v11-provenance.tsv`.

```bash
git add backend docs/batch-factory/v11-provenance.tsv
git commit -m "feat(batch-v11): add Go capability boundary"
```

### Task 2: Make migrations checksum-safe and prove MySQL 8.4 compatibility

**Files:**
- Create: `backend/internal/storage/migrations.go`, `backend/internal/storage/migrations_test.go`
- Create: `backend/internal/storage/batch_factory_v11_schema.go`, `backend/internal/storage/batch_factory_v11_schema_test.go`
- Test: `backend/internal/storage/migrations_mysql84_test.go`

**Interfaces:**
- Consumes: ordered `Migration{Version int, Checksum string, Apply func(context.Context, *sql.Tx) error}` records.
- Produces: `schema_migrations(version, checksum, applied_at)` and `RunMigrations(ctx, db)`.
- Invariant: a recorded checksum mismatch fails before later migration execution; a legacy empty checksum may be backfilled once only through an audited `verified_checksum_backfill` migration.

- [ ] **Step 1: Write failing migration-ledger tests**

```go
func TestRunMigrationsRejectsRecordedChecksumMismatch(t *testing.T) {
    seedMigration(t, db, 26, "wrong")
    err := RunMigrations(ctx, db)
    if err == nil || !strings.Contains(err.Error(), "checksum mismatch") { t.Fatalf("err=%v", err) }
}

func TestMigration27HasNoTextDefault(t *testing.T) {
    for _, statement := range migration27Statements() {
        if strings.Contains(strings.ToUpper(statement), "TEXT NOT NULL DEFAULT") { t.Fatal(statement) }
    }
}
```

- [ ] **Step 2: Run focused tests and confirm failure on the historical version-only ledger**

Run: `cd backend && go test ./internal/storage -run 'TestRunMigrationsRejectsRecordedChecksumMismatch|TestMigration27HasNoTextDefault' -count=1`

Expected: FAIL because the original ledger lacks a checksum and migration 27
contains the MySQL 8.4-incompatible `MEDIUMTEXT NOT NULL DEFAULT ''` definition.

- [ ] **Step 3: Implement checksum ledger and repair migration 27 without rewriting history silently**

Use SHA-256 of canonical SQL plus an explicit constant for callback migrations.
Add checksum columns with a backward-compatible migration, then allow an empty
legacy checksum only when the expected checksum has been verified and an audit
row is written. Replace `admin_note MEDIUMTEXT NOT NULL DEFAULT ''` with a
MySQL-8.4-valid nullable/text representation and normalize it in Go reads.

```go
func checksumFor(m Migration) string {
    return sha256Hex(fmt.Sprintf("v=%d\nsql=%s\ncallback=%s", m.Version, canonicalSQL(m.SQL), m.CallbackChecksum))
}
```

- [ ] **Step 4: Run the required fresh MySQL 8.4 matrix**

Run each case in a newly named Docker volume and retain only redacted test logs:

```bash
cd backend
go test ./internal/storage -run 'TestMySQL84EmptyToLatest|TestMySQL84SchemaOneToLatest|TestMySQL84Schema26ToLatest|TestMySQL84RepeatStartup|TestMySQL84ChecksumMismatch' -count=1
```

Expected: PASS for the four valid paths; the mismatch case passes only because
startup fails closed as asserted.

- [ ] **Step 5: Register empty V11 tables and commit migration integrity**

Register only schema roots needed by later slices: `batch_factory_v11_batches`,
`batch_factory_v11_books`, `batch_factory_v11_videos`, migration/import audit
tables, and capability settings. Do not write a legacy importer yet.

```bash
git add backend/internal/storage
git commit -m "feat(batch-v11): add checksum-safe schema foundation"
```

### Task 3: Add the Node auth/session proxy with no V11 business rules

**Files:**
- Create: `lib/batch-factory-v11/go-proxy.js`, `routes/batch-factory-v11.js`
- Modify: `app.js`
- Test: `test/batch-factory-v11-proxy.test.js`

**Interfaces:**
- Consumes: authenticated Express request and `QIANTIE_GO_BASE_URL` plus `QIANTIE_BRIDGE_SECRET`.
- Produces: a streamed same-method proxy to `http://backend:4000/api/batch-factory/v11/*`.
- Invariant: proxy changes only trusted headers and correlation ID; it never reads/writes V11 JSON fields.

- [ ] **Step 1: Write failing Node tests for routing, signing, and passthrough**

```js
test('V11 proxy forwards a POST body without inspecting settings', async () => {
  const response = await request(app).post('/api/batch-factory/v11/batches').send({ unexpected: 'kept' });
  assert.equal(upstream.calls[0].body, JSON.stringify({ unexpected: 'kept' }));
});

test('V11 proxy rejects unauthenticated browser requests', async () => {
  assert.equal((await request(app).get('/api/batch-factory/v11/capabilities')).status, 401);
});
```

- [ ] **Step 2: Run tests and confirm they fail before the route is mounted**

Run: `node --test test/batch-factory-v11-proxy.test.js`

Expected: FAIL with `404` or missing proxy module.

- [ ] **Step 3: Implement transparent proxying and mount it before legacy routes**

The proxy must preserve status code, content type, response body, and
`X-Request-ID`; it signs only `req.method` and `req.originalUrl` path after the
`/api` prefix is preserved. It uses the existing session identity, not a
client-provided username. Mount `/api/batch-factory/v11` before the existing
`/api/batch-factory` legacy routers so legacy matching cannot intercept V11.

- [ ] **Step 4: Run Node tests and a Go-backed proxy integration test**

Run:

```bash
node --test test/batch-factory-v11-proxy.test.js
cd backend && go test ./internal/httpapi -run TestV11Capabilities -count=1
```

Expected: PASS; request body remains opaque to Node and Go validates signature.

- [ ] **Step 5: Commit the proxy boundary**

```bash
git add app.js lib/batch-factory-v11 routes/batch-factory-v11.js test/batch-factory-v11-proxy.test.js
git commit -m "feat(batch-v11): proxy authenticated V11 API requests"
```

### Task 4: Build Alpha release evidence and rollback tooling

**Files:**
- Create: `scripts/batch-factory-v11-alpha-release.sh`, `scripts/batch-factory-v11-alpha-rollback.sh`
- Test: `test/batch-factory-v11-alpha-release.test.js`
- Create: `docs/batch-factory/alpha-release-manifest.schema.json`

**Interfaces:**
- Release input: explicit compose file, release name, previous web image, previous Go image, backup directory, and immutable target tags.
- Release output: `artifacts/batch-factory-v11/<release>/manifest.json` containing SHA, image digests, backup ID, migration result, capability map, smoke outcome, and rollback command.
- Rollback input: the exact manifest path; no inferred `latest` tag is allowed.

- [ ] **Step 1: Write failing dry-run tests for immutable tags and required rollback data**

```js
test('release rejects latest tags', () => {
  assert.throws(() => validateRelease({ webImage: 'qiantie-web:latest' }), /immutable/);
});

test('rollback consumes the recorded prior images', () => {
  assert.match(renderRollback(manifest), /qiantie-web:sha-previous/);
  assert.match(renderRollback(manifest), /qiantie-backend:sha-previous/);
});
```

- [ ] **Step 2: Run the release-script tests and confirm they fail before scripts exist**

Run: `node --test test/batch-factory-v11-alpha-release.test.js`

Expected: FAIL with missing module or script.

- [ ] **Step 3: Implement fail-closed release and rollback scripts**

`batch-factory-v11-alpha-release.sh --dry-run` must validate all arguments,
reject `latest`/`v8-latest`, capture the pre-release image IDs, run a scoped
MySQL dump through the supplied Compose service, build both image tags with
the current SHA, run health/capability smoke checks, and write the manifest.
The non-dry-run path may execute only after the same validations succeed.
`batch-factory-v11-alpha-rollback.sh` reads the manifest and restores exactly
the recorded web/Go images; it refuses a missing backup ID for schema releases.

- [ ] **Step 4: Run scripts in dry-run mode and complete foundation verification**

Run:

```bash
node --test test/batch-factory-v11-alpha-release.test.js
scripts/batch-factory-v11-alpha-release.sh --dry-run --release bf-v11-s0 --compose-file docker-compose.yml --previous-web qiantie-web:sha-previous --previous-go qiantie-backend:sha-previous --target-web qiantie-web:bf-v11-s0-$(git rev-parse --short HEAD) --target-go qiantie-backend:bf-v11-s0-$(git rev-parse --short HEAD) --backup-dir artifacts/batch-factory-v11
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
cd backend && go test ./...
```

Expected: all tests/builds pass; dry-run writes no deployment and no production
database mutation.

- [ ] **Step 5: Commit the release foundation and update the branch map**

```bash
git add scripts test docs/batch-factory
git commit -m "chore(batch-v11): add alpha release rollback evidence"
```

After this commit, stop. Slice 1 starts only after this foundation is reviewed.
