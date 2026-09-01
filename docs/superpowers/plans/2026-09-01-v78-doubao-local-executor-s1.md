# V78 Doubao Local Executor Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing V78 “豆包本地执行器” settings flow real by adding durable pairing, executor bearer authentication, heartbeat, owner-scoped listing, and online/account-health state.

**Architecture:** Keep Node as the authenticated website gateway and add a Go signed control-plane subrouter under `/api/shuihuo-production/local-executors`. Add a direct executor API under `/api/local-executor/v1` for one-time pairing and bearer-token heartbeat. Persist only hashes of pairing codes and executor tokens; never accept Doubao cookies or credentials.

**Tech Stack:** Go 1.23 standard library, MySQL 8.4, existing Qiantie `BridgeAuth`, React 18 existing Settings page, Node Express gateway.

**Spec:** `docs/superpowers/specs/2026-09-01-v78-doubao-local-executor-design.md`

## Global Constraints

- Existing V78 base HEAD is `8aca2668b332d37f1c7c64030b17220621d74799`.
- Work only on `feat/v78-doubao-local-executor-s1` for this slice.
- Pairing codes expire after 10 minutes and are single-use.
- Executor bearer tokens use at least 256 bits of cryptographic randomness and are stored only as SHA-256 hashes.
- Online means `last_seen_at >= now - 45s`; default heartbeat interval is 15s.
- Only `platform="doubao"` is accepted in Slice 1.
- Do not store or accept Doubao passwords, cookies, local browser profiles, or session material.
- Human verification is status only; do not automate bypass.
- Do not add job claiming/generation/artifact upload in Slice 1.

---

## File Structure

- Create: `backend/internal/localexecutor/types.go` — public domain types and validation.
- Create: `backend/internal/localexecutor/service.go` — pairing/token/heartbeat/list orchestration and crypto helpers.
- Create: `backend/internal/localexecutor/memory_store.go` — deterministic in-memory Store for tests.
- Create: `backend/internal/localexecutor/mysql_store.go` — MySQL implementation.
- Create: `backend/internal/localexecutor/service_test.go` — RED/GREEN service tests.
- Create: `backend/internal/storage/local_executor_schema.go` — separate migration namespace and `AppMigrations()` composition.
- Create: `backend/internal/storage/local_executor_schema_test.go` — migration contract tests.
- Create: `backend/internal/httpapi/local_executor.go` — signed user endpoints plus direct executor endpoints.
- Create: `backend/internal/httpapi/local_executor_test.go` — route/auth/isolation tests.
- Modify: `backend/internal/app/app.go` — construct executor store/service and run combined migrations.
- Modify: `backend/internal/httpapi/router.go` — mount signed shuihuo control plane and direct executor API.
- No Settings-page behavior change is required for the basic S1 contract; existing calls already target the planned paths.

### Task 1: Build the local-executor domain with test-first pairing and heartbeat

**Files:**
- Create: `backend/internal/localexecutor/types.go`
- Create: `backend/internal/localexecutor/service.go`
- Create: `backend/internal/localexecutor/memory_store.go`
- Test: `backend/internal/localexecutor/service_test.go`

**Interfaces:**
- `type Store interface { CreatePairing(...); ConsumePairing(...); CreateExecutor(...); ExecutorByTokenHash(...); UpdateHeartbeat(...); ListExecutors(...) }`
- `func NewService(store Store, now func() time.Time) *Service`
- `func (s *Service) CreatePairing(ctx context.Context, owner, platform string) (PairingSecret, error)`
- `func (s *Service) Pair(ctx context.Context, input PairInput) (PairResult, error)`
- `func (s *Service) Heartbeat(ctx context.Context, token string, input HeartbeatInput) error`
- `func (s *Service) List(ctx context.Context, owner string) ([]ExecutorView, error)`

- [ ] **Step 1: Write failing service tests**

```go
func TestCreatePairingReturnsPlaintextButStoresOnlyHash(t *testing.T) {
    store := NewMemoryStore()
    svc := NewService(store, fixedNow)
    secret, err := svc.CreatePairing(context.Background(), "alice", "doubao")
    if err != nil { t.Fatal(err) }
    if secret.Code == "" { t.Fatal("missing code") }
    if store.PairingPlaintextSeen(secret.Code) { t.Fatal("plaintext pairing code stored") }
}

func TestPairingIsSingleUseAndReturnsHashedTokenCredential(t *testing.T) {
    store := NewMemoryStore()
    svc := NewService(store, fixedNow)
    pairing, _ := svc.CreatePairing(context.Background(), "alice", "doubao")
    first, err := svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao", OS: "windows", Version: "0.1.14"})
    if err != nil { t.Fatal(err) }
    if first.Token == "" { t.Fatal("missing token") }
    if store.ExecutorPlaintextTokenSeen(first.Token) { t.Fatal("plaintext token stored") }
    if _, err := svc.Pair(context.Background(), PairInput{Code: pairing.Code, DeviceName: "DESKTOP-B", Platform: "doubao"}); !errors.Is(err, ErrPairingInvalid) {
        t.Fatalf("second pair err=%v", err)
    }
}

func TestListDerivesOnlineFromLastSeen(t *testing.T) {
    // heartbeat at t0; list at t0+44s => online, at t0+46s => offline.
}

func TestHeartbeatRejectsInvalidAccountCounters(t *testing.T) {
    // available/busy/etc cannot be negative or greater than total.
}
```

- [ ] **Step 2: Run RED tests**

Run: `cd backend && go test ./internal/localexecutor -count=1`

Expected: FAIL because the package/API does not exist.

- [ ] **Step 3: Implement minimal domain and memory store**

Use `crypto/rand` for pairing/token material, normalize displayed pairing codes by removing separators before hashing, use `sha256.Sum256`, and compare hashes as fixed-size values. Pairing TTL is 10 minutes. Token material is 32 random bytes encoded with `base64.RawURLEncoding`.

- [ ] **Step 4: Run GREEN tests**

Run: `cd backend && go test ./internal/localexecutor -count=1`

Expected: PASS with single-use pairing, token auth, offline threshold, owner isolation, and counter validation covered.

- [ ] **Step 5: Commit domain**

```bash
git add backend/internal/localexecutor
git commit -m "feat(v78): add local executor pairing domain"
```

### Task 2: Add durable MySQL persistence without changing V11 migration checksums

**Files:**
- Create: `backend/internal/storage/local_executor_schema.go`
- Create: `backend/internal/storage/local_executor_schema_test.go`
- Create: `backend/internal/localexecutor/mysql_store.go`
- Modify: `backend/internal/app/app.go`

**Interfaces:**
- `func LocalExecutorMigrations() []Migration`
- `func AppMigrations() []Migration` returns existing `V11Migrations()` plus local-executor migrations.
- `func NewMySQLStore(db *sql.DB) *MySQLStore`

- [ ] **Step 1: Write failing migration contract tests**

```go
func TestAppMigrationsKeepExistingV11Checksums(t *testing.T) {
    before := V11Migrations()
    all := AppMigrations()
    if len(all) <= len(before) { t.Fatal("local executor migration missing") }
    for i := range before {
        if ChecksumFor(before[i]) != ChecksumFor(all[i]) {
            t.Fatalf("v11 migration %d checksum changed", before[i].Version)
        }
    }
}

func TestLocalExecutorSchemaStoresHashesNotPlaintextColumns(t *testing.T) {
    sql := strings.Join(LocalExecutorMigrations()[0].SQL, "\n")
    if strings.Contains(sql, "pairing_code ") || strings.Contains(sql, "executor_token ") {
        t.Fatal("plaintext secret column present")
    }
}
```

- [ ] **Step 2: Run RED migration tests**

Run: `cd backend && go test ./internal/storage -run 'TestAppMigrationsKeepExistingV11Checksums|TestLocalExecutorSchemaStoresHashesNotPlaintextColumns' -count=1`

Expected: FAIL because the new migration functions do not exist.

- [ ] **Step 3: Implement schema and MySQL store**

Create migration version `7801001` with:

```sql
CREATE TABLE IF NOT EXISTS local_executor_pairings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  code_hash BINARY(32) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_local_executor_pairings_code_hash (code_hash),
  KEY idx_local_executor_pairings_owner_created (owner_username, created_at)
) ENGINE=InnoDB;
```

and:

```sql
CREATE TABLE IF NOT EXISTS local_executors (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_username VARCHAR(191) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  device_name VARCHAR(191) NOT NULL DEFAULT '',
  os VARCHAR(32) NOT NULL DEFAULT '',
  app_version VARCHAR(64) NOT NULL DEFAULT '',
  accounts_total INT NOT NULL DEFAULT 0,
  accounts_available INT NOT NULL DEFAULT 0,
  accounts_busy INT NOT NULL DEFAULT 0,
  accounts_quota_exhausted INT NOT NULL DEFAULT 0,
  accounts_login_error INT NOT NULL DEFAULT 0,
  accounts_human_verification INT NOT NULL DEFAULT 0,
  last_seen_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_local_executors_token_hash (token_hash),
  KEY idx_local_executors_owner_updated (owner_username, updated_at)
) ENGINE=InnoDB;
```

Consume pairing inside a transaction using a row lock, verify `consumed_at IS NULL` and `expires_at > now`, mark consumed, then create the executor.

- [ ] **Step 4: Run storage/localexecutor tests**

Run: `cd backend && go test ./internal/storage ./internal/localexecutor -count=1`

Expected: PASS; V11 checksum tests remain unchanged.

- [ ] **Step 5: Commit persistence**

```bash
git add backend/internal/storage/local_executor_schema.go backend/internal/storage/local_executor_schema_test.go backend/internal/localexecutor/mysql_store.go backend/internal/app/app.go
git commit -m "feat(v78): persist local executor control state"
```

### Task 3: Expose signed website endpoints and direct executor endpoints

**Files:**
- Create: `backend/internal/httpapi/local_executor.go`
- Create: `backend/internal/httpapi/local_executor_test.go`
- Modify: `backend/internal/httpapi/router.go`

**Interfaces:**
- `RouterOptions.LocalExecutors *localexecutor.Service`
- Signed control plane:
  - `GET /api/shuihuo-production/local-executors`
  - `POST /api/shuihuo-production/local-executors/pairings`
- Direct plane:
  - `POST /api/local-executor/v1/pair`
  - `POST /api/local-executor/v1/heartbeat`

- [ ] **Step 1: Write failing HTTP tests**

```go
func TestLocalExecutorListRejectsUnsignedWebsiteRequest(t *testing.T) {
    api := newExecutorTestRouter(t)
    req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executors", nil)
    rec := httptest.NewRecorder()
    api.ServeHTTP(rec, req)
    if rec.Code != http.StatusUnauthorized { t.Fatalf("got %d", rec.Code) }
}

func TestWebsiteCanCreatePairingAndExecutorCanPair(t *testing.T) {
    // sign the pairing request as alice, capture code, then call direct /pair and assert token/executorId.
}

func TestExecutorHeartbeatRequiresBearerToken(t *testing.T) {
    // no Authorization => 401; valid token => 200.
}

func TestAliceCannotListBobsExecutor(t *testing.T) {
    // pair one executor for bob, then list signed as alice and assert empty.
}
```

- [ ] **Step 2: Run RED HTTP tests**

Run: `cd backend && go test ./internal/httpapi -run 'TestLocalExecutor|TestWebsiteCanCreatePairing|TestExecutorHeartbeat|TestAliceCannotListBobsExecutor' -count=1`

Expected: FAIL with missing routes/options.

- [ ] **Step 3: Implement handlers and router mounting**

Mount a dedicated signed `shuihuo` mux through the existing `BridgeAuth`. Keep direct routes outside `BridgeAuth` and authenticate heartbeat through `Authorization: Bearer`. Decode JSON with bounded request bodies, return JSON errors, and never include token hashes or pairing hashes in responses.

- [ ] **Step 4: Run GREEN HTTP tests**

Run: `cd backend && go test ./internal/httpapi ./internal/localexecutor -count=1`

Expected: PASS for signed control plane, pairing, bearer heartbeat, owner isolation, and online state.

- [ ] **Step 5: Commit API**

```bash
git add backend/internal/httpapi
git commit -m "feat(v78): expose local executor control api"
```

### Task 4: Verify existing Settings-page compatibility and full backend regression

**Files:**
- Inspect: `frontend/src/user/pages/SettingsPage.jsx`
- Inspect: `routes/shuihuo-production.js`
- No UI change unless the verified API response shape requires one.

- [ ] **Step 1: Verify response contract matches current UI**

Current UI requires only:

```js
const result = await apiRequest('/api/shuihuo-production/local-executors')
setLocalExecutors(Array.isArray(result.executors) ? result.executors : [])
```

and:

```js
const result = await apiRequest('/api/shuihuo-production/local-executors/pairings', {
  method: 'POST',
  body: JSON.stringify({ platform: 'doubao' })
})
setPairing(result) // must include result.code
```

Ensure every returned executor contains boolean `online`.

- [ ] **Step 2: Run complete Go regression**

Run: `cd backend && go test ./... -count=1`

Expected: PASS with zero failures.

- [ ] **Step 3: Run Node/frontend checks if dependencies are available**

Run: `node --check routes/shuihuo-production.js && npm --prefix frontend run build`

Expected: PASS. If the execution environment cannot install dependencies or access the repository checkout, record that limitation explicitly instead of claiming the build passed.

- [ ] **Step 4: Compare branch against base**

Review all changed files and confirm there are no changes to Batch Factory V11 migration contents/checksums, no Doubao credentials in schemas/logs, and no fake generation/job endpoints.

- [ ] **Step 5: Commit any compatibility-only adjustment and stop**

Use a narrowly scoped commit only if required. Slice 1 is complete when Settings pairing/listing can terminate on real Go endpoints and heartbeat can drive the displayed online state.