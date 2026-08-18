# Model Center Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing Go Shuihuo model catalog into a four-kind, configuration-driven Model Center with immutable `modelId` routing, server-side credential references, dynamic `uiSchema` validation, compatible legacy reads, and reliable sync/async execution.

**Architecture:** Go owns the model catalog, credential resolution, validation, template execution, and task lifecycle. MySQL keeps stable definitions plus immutable versions; Express remains the multi-page gateway and does not become a second model authority. React/Ant Design consumes public/admin APIs and renders the dense catalog and dynamic editor accepted during brainstorming.

**Tech Stack:** Go, `database/sql`, MySQL migrations, `net/http`, chi, existing Shuihuo stores/adapters, Node.js Express, React, Ant Design, Node test runner, Go `httptest`.

---

## Working Rules

- Work in `/Users/ming/Downloads/qiantie` and preserve the dirty worktree. Do not reset, checkout, or stage unrelated files.
- Before each task, run `git status --short` and record files already modified by other work.
- Use a fake HTTP provider in tests. Never put a real API key in a fixture, database row, log, import, export, or browser request.
- Keep each commit limited to the files listed in that task. If a task touches a file already modified by another change, read the current file and apply the smallest compatible edit.
- The current adapter and route behavior remains available until the compatibility task explicitly replaces it and its tests pass.

## File Map

Create or modify only these responsibilities for this feature:

| Path | Responsibility |
| --- | --- |
| `backend/internal/storage/migrations.go` | Add idempotent model-center columns, legacy `modelId` backfill, and the later task attempt/recovery migration. |
| `backend/internal/shuihuo/models/catalog.go` | Stable model contract, public/admin projections, validation, visibility, and model ID rules. |
| `backend/internal/shuihuo/models/credentials.go` | Environment-backed credential reference registry and redacted status metadata. |
| `backend/internal/shuihuo/models/schema.go` | `uiSchema` parse, defaulting, type normalization, and unknown-field rejection. |
| `backend/internal/shuihuo/models/template.go` | Typed template evaluator for paths, arrays, `$map`, `$concat`, `$if`, and empty templates. |
| `backend/internal/shuihuo/models/polling.go` | Declarative polling configuration and provider state mapping. |
| `backend/internal/shuihuo/models/generic_http_adapter.go` | Execute the normalized generic request and redact provider failures. |
| `backend/internal/shuihuo/models/*_test.go` | Pure contract, schema, template, credential, adapter, and polling tests. |
| `backend/internal/shuihuo/store/models.go` | List/get/create/version/archive/duplicate/import/export persistence. |
| `backend/internal/shuihuo/store/models_test.go` | Store query and transaction tests using the existing SQL mock style. |
| `backend/internal/shuihuo/tasks/worker.go` | Attempt marker, lease/CAS, polling, finalization, and recovery integration. |
| `backend/internal/shuihuo/tasks/worker_test.go` | Fake-provider task lifecycle and recovery tests. |
| `backend/internal/httpapi/shuihuo_handlers.go` | Replace the temporary empty admin-list handler and add model-center request decoding/projections. |
| `backend/internal/httpapi/shuihuo_model_handlers.go` | Focused admin/public model endpoints and import/export handlers. |
| `backend/internal/httpapi/shuihuo_model_handlers_test.go` | Auth, redaction, validation, visibility, and CRUD HTTP tests. |
| `backend/internal/httpapi/router.go` | Register the new owner/admin/public routes without changing Express routes. |
| `frontend/src/shared/api/shuihuoProduction.js` | Public/admin model API calls, CRUD, duplicate, credential refs, import/export. |
| `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx` | Accepted dense table, filters, bulk actions, create/edit drawer, dynamic preview. |
| `frontend/src/admin/pages/shuihuo-model-catalog.js` | Pure form mapping, filters, sort, and safe JSON parsing helpers. |
| `frontend/src/admin/pages/shuihuo-model-catalog.test.mjs` | Frontend contract tests for four kinds and immutable model IDs. |
| `tests/shuihuo-model-catalog-contract.test.js` | Node contract coverage for API/page boundaries. |
| `tests/shuihuo-model-execution-contract.test.js` | Express-to-Go payload and hidden-model boundary tests. |

Existing files such as `backend/internal/shuihuo/models/adapter.go`, `providers/text_completion.go`, the existing task store, and the Shuihuo frontend task/config views are modified only where the new `modelId` contract must be threaded through. No unrelated UI redesign is part of this plan.

### Task 1: Establish Baseline And Migration Contract

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Test: `backend/internal/storage/migrations_test.go`

- [ ] **Step 1: Capture the clean baseline for this feature**

Run:

```bash
cd /Users/ming/Downloads/qiantie
git status --short
cd backend
go test ./internal/storage ./internal/shuihuo/models ./internal/shuihuo/store
```

Expected: the existing targeted packages pass; any pre-existing failure is recorded before edits and is not attributed to this feature.

- [ ] **Step 2: Write the migration tests before the schema change**

Add assertions in `backend/internal/storage/migrations_test.go` for a new model-center migration containing these exact invariants:

```go
for _, required := range []string{
    "model_key VARCHAR(128) NOT NULL DEFAULT ''",
    "hidden BOOLEAN NOT NULL DEFAULT FALSE",
    "sort_order INT NOT NULL DEFAULT 0",
    "admin_note MEDIUMTEXT NOT NULL DEFAULT ''",
    "base_domain VARCHAR(512) NOT NULL DEFAULT ''",
    "base_path VARCHAR(1024) NOT NULL DEFAULT ''",
    "polling_template MEDIUMTEXT NULL",
    "image_input_format VARCHAR(16) NOT NULL DEFAULT 'url'",
    "image_request_mode VARCHAR(16) NOT NULL DEFAULT 'json'",
    "runtime_policy_json JSON NULL",
    "UNIQUE KEY uniq_model_definition_key",
} {
    if !strings.Contains(migration.sql, required) {
        t.Fatalf("model-center migration missing %q", required)
    }
}
```

Also assert that the migration is idempotent and contains a deterministic backfill for legacy rows.

- [ ] **Step 3: Add the idempotent schema migration**

Add a new migration after the current model/config migrations. The migration must use the repository's existing column-existence executor pattern rather than assuming `ALTER TABLE ADD COLUMN` can safely run twice. Add only the definition and version columns for the catalog in this task. Backfill existing rows as `legacy-<kind>-<id>` and fail the migration if a collision is detected rather than silently changing a previously assigned key. Task 8 adds the separate task-recovery migration after its columns and worker behavior are defined.

Use this model-key backfill shape in the custom apply function:

```sql
UPDATE model_definitions
SET model_key = CONCAT('legacy-', LOWER(kind), '-', id)
WHERE model_key = '';
```

The existing numeric primary keys and foreign keys remain unchanged.

- [ ] **Step 4: Run migration tests and commit the database contract**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/storage ./internal/shuihuo/store
```

Expected: migration tests pass, including the repeat-application test. Commit only `backend/internal/storage/migrations.go` and `backend/internal/storage/migrations_test.go`:

```bash
git add backend/internal/storage/migrations.go backend/internal/storage/migrations_test.go
git commit -m "feat: add model center compatibility schema"
```

### Task 2: Add Stable Model Contract And Credential Registry

**Files:**
- Modify: `backend/internal/shuihuo/models/catalog.go`
- Create: `backend/internal/shuihuo/models/credentials.go`
- Test: `backend/internal/shuihuo/models/catalog_test.go`
- Create: `backend/internal/shuihuo/models/credentials_test.go`

- [ ] **Step 1: Write failing contract tests**

Add tests for immutable model IDs, all four kinds, hidden/public projections, and allowlisted credential references:

```go
func TestValidateDefinitionRequiresStableModelID(t *testing.T) {
    err := ValidateDefinition(Definition{Name: "image", Kind: KindImage, AdapterKind: AdapterGenericHTTP})
    if err == nil || !strings.Contains(err.Error(), "model id") {
        t.Fatalf("ValidateDefinition() error = %v", err)
    }
}

func TestPublicModelOmitsHiddenAndPrivateFields(t *testing.T) {
    public := ToPublic(Definition{ModelID: "image-v1", Hidden: true, AdminNote: "internal", Endpoint: "https://private"})
    if public.ModelID != "image-v1" || public.Hidden {
        t.Fatalf("unexpected public model: %#v", public)
    }
    body, _ := json.Marshal(public)
    if strings.Contains(string(body), "private") || strings.Contains(string(body), "internal") {
        t.Fatalf("public model leaked private fields: %s", body)
    }
}
```

Add credential tests proving unknown refs fail, configured refs report `Configured=true`, and `Resolve` returns the value only to server code.

- [ ] **Step 2: Implement the contract without breaking old numeric callers**

Extend `models.Definition` with `ModelID`, `Hidden`, `SortOrder`, `AdminNote`, `BaseDomain`, `BasePath`, `PollingTemplate`, `ImageInputFormat`, `ImageRequestMode`, and `RuntimePolicyJSON`. Preserve `ID`, `VersionID`, `Endpoint`, and existing adapter fields during the compatibility period.

Add these stable helpers:

```go
func ValidateModelID(value string) error
func (model Definition) PubliclySelectable() bool
func (model Definition) AvailableTo(role string, persistedReference bool) bool
func ToPublic(model Definition) PublicModel
func ToAdmin(model Definition) AdminModel
```

`PubliclySelectable` must require `Enabled && !Hidden`; `AvailableTo` must require `Enabled` and allow a hidden model only when `persistedReference` is true. `ToPublic` must not include endpoint, templates, credential ref, polling config, or admin note.

- [ ] **Step 3: Implement the environment-backed credential registry**

Create `models.CredentialRegistry` with this interface:

```go
type CredentialReference struct {
    ID         string `json:"id"`
    Label      string `json:"label"`
    Configured bool   `json:"configured"`
}

type CredentialReferenceConfig struct {
    Label               string
    EnvironmentVariable string
}

type CredentialRegistry struct {
    environment map[string]string
    references  map[string]CredentialReferenceConfig
}

func NewCredentialRegistry(env map[string]string, references map[string]CredentialReferenceConfig) *CredentialRegistry
func (r *CredentialRegistry) List() []CredentialReference
func (r *CredentialRegistry) Resolve(referenceID string) (string, error)
```

Store reference IDs and labels in server configuration. Resolve the mapped environment variable only in memory. Return a generic missing-credential error and never include the environment variable name or secret value in that error.

- [ ] **Step 4: Run model package tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/models
```

Expected: PASS, including all existing adapter/public-redaction tests. Commit only the catalog and credential files/tests.

### Task 3: Implement uiSchema Normalization And Template Evaluation

**Files:**
- Create: `backend/internal/shuihuo/models/schema.go`
- Create: `backend/internal/shuihuo/models/schema_test.go`
- Create: `backend/internal/shuihuo/models/template.go`
- Create: `backend/internal/shuihuo/models/template_test.go`
- Modify: `backend/internal/shuihuo/models/catalog.go`

- [ ] **Step 1: Write failing schema tests**

Define the public function and tests first:

```go
func NormalizeInputs(raw map[string]any, schema UISchema, required []string) (map[string]any, error)
```

Tests must cover string, number, boolean, enum, default values, missing required `prompt`, unknown fields, range violations, and a bounded list. An input such as `{"prompt":"x","secret":"y"}` must fail before template rendering.

- [ ] **Step 2: Implement schema parsing and normalization**

Use explicit Go types:

```go
type UISchema map[string]UIField

type UIField struct {
    Label    string     `json:"label"`
    Type     string     `json:"type"`
    Default  any        `json:"default"`
    Required bool       `json:"required"`
    Options  []UIOption `json:"options"`
    Min      *float64   `json:"min"`
    Max      *float64   `json:"max"`
    MaxItems int        `json:"maxItems"`
}
```

Reject unsupported field types, duplicate option values, excessive list length, non-finite numbers, and values that cannot be normalized to the declared type. Return field-specific errors with no secret-bearing input echo.

- [ ] **Step 3: Write failing template tests**

Use a normalized input map and assert typed whole-value replacement, nested paths, array indexes, `$map`, `$concat`, `$if`, `{}`, unknown variables, and path traversal rejection:

```go
got, err := RenderTemplate(map[string]any{
    "model": "{{model}}",
    "body": map[string]any{
        "prompt": map[string]any{"$concat": []any{"{{prefix}}", " ", "{{prompt}}"}},
        "first": "{{items[0].url}}",
    },
}, map[string]any{
    "model": "image-v2",
    "prefix": "cinematic",
    "prompt": "rain",
    "items": []any{map[string]any{"url": "https://cdn"}},
})
```

- [ ] **Step 4: Implement the safe evaluator**

Expose:

```go
func RenderTemplate(template any, inputs map[string]any) (any, error)
```

Preserve non-string types when the entire value is a template token. Resolve dot paths and array indexes from the normalized input map. Implement `$map`, `$concat`, and `$if` only as JSON objects with validated argument shapes. When the template is an empty object, return a deep copy of normalized inputs. Never evaluate Go expressions, URLs, shell fragments, or arbitrary paths.

- [ ] **Step 5: Run pure model tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/models
```

Expected: PASS with no network access. Commit the schema/template files and their tests.

### Task 4: Upgrade Persistence And Admin Model Store

**Files:**
- Modify: `backend/internal/shuihuo/store/models.go`
- Create: `backend/internal/shuihuo/store/models_test.go`
- Modify: `backend/internal/shuihuo/models/catalog.go`

- [ ] **Step 1: Define store-facing request types and failing tests**

Add store methods with stable names:

```go
func (s *Models) GetByModelID(ctx context.Context, modelID string, includeHidden bool, persistedReference bool) (models.Definition, error)
func (s *Models) List(ctx context.Context, filter models.ListFilter) ([]models.Definition, int, error)
func (s *Models) Create(ctx context.Context, ownerID int64, model models.Definition) (models.Definition, error)
func (s *Models) CreateVersion(ctx context.Context, ownerID int64, modelID string, version models.VersionInput) (models.Definition, error)
func (s *Models) Archive(ctx context.Context, modelID string) error
```

Test SQL projections include all new columns, sort by `sort_order` then stable name, reject a hidden model for direct public lookup, and allow an existing persisted reference only when the model is enabled.

- [ ] **Step 2: Update query scanning and JSON decoding**

Centralize the SELECT column list in `modelDefinitionColumns` and use it for list, admin, public, and model-ID lookup. Decode roles, `uiSchema`, and runtime policy through typed helpers. Keep legacy numeric `GetEnabled` and `GetVersion` methods as wrappers around the new projection so existing Shuihuo handlers compile unchanged.

- [ ] **Step 3: Implement transactional create/version/archive/duplicate behavior**

Create inserts a stable `model_key` and first version in one transaction. Update never edits a version; it calculates `MAX(version_number)+1` and inserts the new version. Archive sets both `enabled=false` and `hidden=true`. Duplicate creates a disabled row and copies the latest non-secret configuration only after validating a new `modelId`.

- [ ] **Step 4: Add import/export serialization**

Use a versioned credential-free structure:

```go
type ModelExport struct {
    Version int              `json:"version"`
    Models  []ModelExportRow `json:"models"`
}
```

The row includes model ID, kind, name, visibility, UI schema, provider templates, polling/runtime policy, and credential reference ID, but never a resolved value. Validate every row before the transaction creates any definition.

- [ ] **Step 5: Run store tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/store ./internal/shuihuo/models
```

Expected: PASS, including existing asset/task store tests. Commit only the model store/catalog files and tests.

### Task 5: Add Generic Sync Execution And Error Redaction

**Files:**
- Modify: `backend/internal/shuihuo/models/generic_http_adapter.go`
- Modify: `backend/internal/shuihuo/models/adapter.go`
- Create: `backend/internal/shuihuo/models/executor.go`
- Create: `backend/internal/shuihuo/models/executor_test.go`

- [ ] **Step 1: Write fake-provider tests**

Use `httptest.NewTLSServer` to prove:

```go
server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if r.Header.Get("Authorization") != "Bearer test-secret" {
        t.Fatal("credential was not sent to the fake provider")
    }
    _, _ = w.Write([]byte(`{"data":{"url":"https://cdn.example/result.png"}}`))
}))
```

Assert the task result contains the URL, while returned errors and captured logs do not contain `test-secret`. Add tests for provider 4xx/5xx, malformed JSON, response mapping failure, request timeout, and invalid outbound URL.

- [ ] **Step 2: Add an execution contract**

Define:

```go
type ExecuteInput struct {
    ModelID string
    Inputs  map[string]any
    Note    string
}

type ExecuteResult struct {
    ResultURL       string
    ProviderTaskID  string
    NormalizedInput map[string]any
}

func Execute(ctx context.Context, definition Definition, input ExecuteInput, credentials *CredentialRegistry) (ExecuteResult, error)
```

The function resolves `uiSchema`, validates the model kind, builds `baseDomain + basePath`, renders the request, and invokes a registered adapter. It must not accept endpoint/template values from `ExecuteInput`.

- [ ] **Step 3: Replace the fixed literal substitutions with the safe evaluator**

Keep the existing adapter interface usable for current callers, but route generic HTTP bodies and headers through `NormalizeInputs` and `RenderTemplate`. Support JSON and multipart request modes behind explicit model configuration. Redact credential-bearing headers and bodies before wrapping provider errors.

- [ ] **Step 4: Run adapter/executor tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/models
```

Expected: PASS with only the fake provider. Commit adapter, executor, and tests.

### Task 6: Implement Admin/Public HTTP Contracts

**Files:**
- Create: `backend/internal/httpapi/shuihuo_model_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_model_handlers_test.go`
- Modify: `backend/internal/httpapi/shuihuo_handlers.go`
- Modify: `backend/internal/httpapi/router.go`

- [ ] **Step 1: Write HTTP contract tests before replacing the temporary handler**

Test owner-only access and redaction with requests against `api.Router()`:

```go
req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/models", nil)
req.Header.Set("Authorization", "Bearer user-token")
response := httptest.NewRecorder()
api.Router().ServeHTTP(response, req)
if response.Code != http.StatusOK { t.Fatalf("status = %d", response.Code) }
```

Cover public filtering (`enabled && !hidden`), admin list filters, credential-reference list, create, version update, duplicate, archive, import/export, malformed JSON, unknown credential ref, and disabled-model rejection. Assert endpoint/template/credential reference are absent from public JSON.

- [ ] **Step 2: Add explicit request/response DTOs**

Create `adminModelInput`, `modelListQuery`, and `publicModelResponse` in `shuihuo_model_handlers.go`. Decode `modelId`, `name`, `kind`, `hidden`, `sortOrder`, `uiSchema`, templates, polling, runtime policy, and `credentialRef`. Pass only owner-authenticated user IDs to the store. Return consistent errors:

```go
writeJSON(w, http.StatusBadRequest, map[string]string{"code":"MODEL_INPUT_INVALID", "error": err.Error()})
```

Use `409` for unavailable/disabled model references and `422` for administrator configuration validation.

- [ ] **Step 3: Register all routes without changing Express routing**

Register under the existing `/api` and `/api/shuihuo-production` groups:

```go
r.With(api.requireOwner).Get("/shuihuo-production/admin/models", api.handleListAdminModels)
r.With(api.requireOwner).Post("/shuihuo-production/admin/models", api.handleCreateAdminModel)
r.With(api.requireOwner).Get("/shuihuo-production/admin/model-credential-refs", api.handleListCredentialRefs)
r.With(api.requireAuth).Get("/shuihuo-production/models", api.handleListPublicModels)
```

Add the remaining `{modelId}` CRUD/import/export routes beside these routes and remove the empty `handleListAdminModels` implementation from `shuihuo_handlers.go`.

- [ ] **Step 4: Run HTTP tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/httpapi ./internal/shuihuo/models ./internal/shuihuo/store
```

Expected: PASS, with owner/user permissions and public redaction covered. Commit only the model HTTP files and router/handler changes.

### Task 7: Thread modelId Through Legacy Shuihuo Reads And Task Lifecycle

**Files:**
- Modify: `backend/internal/shuihuo/store/tasks.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Modify: `backend/internal/shuihuo/tasks/worker_test.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_prompt_generation_handlers.go`
- Test: `tests/shuihuo-model-execution-contract.test.js`

- [ ] **Step 1: Add task snapshot and attempt-marker tests**

Assert that a created task stores both stable model identity and minimal inputs:

```go
if task.ModelID != "image-create-v2" || task.ModelVersionID != 4 {
    t.Fatalf("task model snapshot = %#v", task)
}
if strings.Contains(task.InputSnapshot, "Authorization") {
    t.Fatal("task snapshot contains provider credentials")
}
```

Add tests for `upstream_started_at`, provider task ID, lease owner, lease expiry, compare-and-set finalization, and retry count.

- [ ] **Step 2: Add resolver precedence**

Use the following precedence in business handlers:

```go
if request.ModelID != "" {
    definition = modelsStore.GetByModelID(ctx, request.ModelID, false, false)
} else if request.LegacyModelID > 0 {
    definition = modelsStore.GetEnabled(ctx, request.LegacyModelID)
} else {
    return model unavailable
}
```

For existing persisted project configuration, call the same resolver with `persistedReference=true`; do not allow a hidden model through a direct browser request.

- [ ] **Step 3: Integrate sync results without changing old adapters**

When the resolved definition has a new generic configuration, call `models.Execute`; otherwise call the existing registered adapter. Store `modelId` and version in the same task snapshot for both branches, so retry/history can identify which path ran.

- [ ] **Step 4: Run gateway and task tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/tasks ./internal/httpapi ./internal/shuihuo/store
cd ..
node --test tests/shuihuo-model-execution-contract.test.js tests/shuihuo-gateway.test.js
```

Expected: legacy payload tests still pass, new model IDs are forwarded, and hidden models cannot be invoked by guessed IDs. Commit only the listed task/handler/test files.

### Task 8: Add Async Polling, Leases, And Recovery

**Files:**
- Create: `backend/internal/shuihuo/models/polling.go`
- Create: `backend/internal/shuihuo/models/polling_test.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Modify: `backend/internal/shuihuo/tasks/worker_test.go`
- Modify: `backend/internal/shuihuo/store/tasks.go`
- Modify: `backend/internal/storage/migrations.go`

- [ ] **Step 1: Write polling state tests**

Use a fake provider that returns `queued`, `processing`, `succeeded`, and `failed` responses. Assert a temporary network error leaves the task `processing` and increments a bounded retry counter instead of marking it failed.

- [ ] **Step 2: Define polling configuration and state mapping**

Add:

```go
type PollingTemplate struct {
    StatusPath       string   `json:"statusPath"`
    ResultPath       string   `json:"resultPath"`
    ProviderTaskPath string   `json:"providerTaskPath"`
    SuccessValues    []string `json:"successValues"`
    FailureValues    []string `json:"failureValues"`
    IntervalSeconds  int      `json:"intervalSeconds"`
    DeadlineSeconds  int      `json:"deadlineSeconds"`
}

func ParsePollingTemplate(raw string) (PollingTemplate, error)
func NextPollingState(template PollingTemplate, body []byte) (state string, resultURL string, err error)
```

Reject missing task/status paths, zero intervals, deadlines above the server maximum, and ambiguous success/failure values.

- [ ] **Step 3: Implement lease and CAS worker operations**

Add store methods for `ClaimProcessingTask`, `MarkUpstreamStarted`, `UpdatePollAttempt`, and `FinalizeTask`. Each update must include the expected task status and lease owner in its `WHERE` clause. Release the lease in `defer` even when the provider or mapping fails.

- [ ] **Step 4: Implement stale-task recovery**

The recovery loop selects `processing` tasks whose lease expired, claims one, reloads the immutable model version and minimal input snapshot, then resumes polling. It must not submit a second initial request when `upstream_started_at` is already set and no provider task ID exists; mark that case `manual_recovery_required` with a redacted diagnostic instead of guessing.

- [ ] **Step 5: Run polling/recovery tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/shuihuo/models ./internal/shuihuo/tasks ./internal/shuihuo/store ./internal/storage
```

Expected: PASS for success, transient failures, deadline, lease contention, recovery, and no duplicate finalization. Commit only polling/worker/store/migration files and tests.

### Task 9: Implement React/Ant Design Catalog And Editor

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx`
- Create: `frontend/src/admin/pages/shuihuo-model-catalog.js`
- Create: `frontend/src/admin/pages/shuihuo-model-catalog.test.mjs`
- Modify: `tests/shuihuo-model-catalog-contract.test.js`

- [ ] **Step 1: Write pure frontend helper tests**

Test these helpers:

```js
assert.deepEqual(filterModels(models, { kind: 'image', status: 'enabled', search: 'image-v2' }), [models[1]]);
assert.equal(canEditModelId({ modelId: 'image-v2', persisted: true }), false);
assert.deepEqual(parseJsonField('{"size":{"type":"string"}}'), { size: { type: 'string' } });
```

Cover all four kind tabs, enabled/disabled filters, hidden state, stable sort, invalid JSON, long IDs, and redacted admin fields.

- [ ] **Step 2: Expand the API client**

Add these exact functions to `frontend/src/shared/api/shuihuoProduction.js`:

```js
export function getAdminModel(modelId) { return apiRequest(`${base}/admin/models/${encodeURIComponent(modelId)}`); }
export function updateAdminModel(modelId, payload) { return apiRequest(`${base}/admin/models/${encodeURIComponent(modelId)}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function duplicateAdminModel(modelId, payload) { return apiRequest(`${base}/admin/models/${encodeURIComponent(modelId)}/duplicate`, { method: 'POST', body: JSON.stringify(payload) }); }
export function archiveAdminModel(modelId) { return apiRequest(`${base}/admin/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' }); }
export function listModelCredentialRefs() { return apiRequest(`${base}/admin/model-credential-refs`); }
```

Update `createAdminModel` to send `modelId`, `hidden`, `sortOrder`, `adminNote`, `baseDomain`, `basePath`, `imageInputFormat`, `imageRequestMode`, `pollingTemplate`, and `runtimePolicy` while preserving the current adapter fields during transition.

- [ ] **Step 3: Replace the page table with the accepted dense catalog**

Use Ant Design `Tabs`, `Segmented`, `Input.Search`, `Table`, `Switch`, `Tag`, `Drawer`, `Form`, `Input.TextArea`, `Upload`, and `Modal.confirm`. Keep `rowKey="modelId"`. The table must include selection, kind, name, `modelId`, generation policy, image protocol, sort order, enabled, hidden, and row actions. Use `whiteSpace: 'nowrap'` for `modelId` and an explicit copy icon with a tooltip.

Use independent loading state for refresh, save, archive, import, export, and bulk actions. A failed model save must not clear the drawer or replace the current table with an empty array.

- [ ] **Step 4: Implement the four-section editor and public form preview**

Keep `modelId` disabled when editing. Load credential refs from the owner endpoint and render only IDs/labels/status. Render `uiSchema` fields in a preview panel and validate JSON before submit. Disable `启用` when server-side validation reports a missing credential, invalid template, or incomplete provider configuration.

- [ ] **Step 5: Run frontend tests and build**

Run:

```bash
cd /Users/ming/Downloads/qiantie
node --test frontend/src/admin/pages/shuihuo-model-catalog.test.mjs
npm --prefix frontend run build
node --test tests/shuihuo-model-catalog-contract.test.js
```

Expected: helper/contract tests pass and the Vite build completes. Commit only the frontend API/page/helper/test files.

### Task 10: Add Import/Export, Public Model Selection, And Legacy Migration UI

**Files:**
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `backend/internal/httpapi/shuihuo_model_handlers.go`
- Modify: `tests/shuihuo-gateway.test.js`
- Create: `tests/shuihuo-model-import-export.test.js`

- [ ] **Step 1: Add import/export contract tests**

Export JSON must contain `version` and model rows but never a resolved credential. Import of one invalid row must create zero rows. Duplicate must force `enabled=false` and a new immutable model ID.

- [ ] **Step 2: Add public model loading and explicit selection**

Load `/api/shuihuo-production/models` for the current account and use `modelId` in new user requests. Keep the numeric fields only for legacy saved configurations and show a migration-safe label while the server resolves them.

- [ ] **Step 3: Preserve hidden persisted selections**

The browser must not show hidden models in new selectors. When a saved project contains a hidden model, the server returns a non-editable “当前配置已隐藏” state and permits the existing server-side reference only if the model remains enabled. Users cannot type an arbitrary hidden ID into the request payload.

- [ ] **Step 4: Add controlled import/export UI**

The admin page exports a Blob download and imports a selected JSON file. Display row-level validation errors returned by the server; do not render the imported credential reference as a secret or attempt to auto-create missing credential refs.

- [ ] **Step 5: Run route/UI tests and commit**

Run:

```bash
cd /Users/ming/Downloads/qiantie
node --test tests/shuihuo-gateway.test.js tests/shuihuo-model-import-export.test.js tests/shuihuo-model-catalog-contract.test.js
```

Expected: public selection, hidden behavior, import/export redaction, and legacy numeric compatibility pass. Commit only the listed user/config/API/test files.

### Task 11: End-To-End Verification And Controlled Rollout Checks

**Files:**
- Modify: `docs/shuihuo-production-operations.md`
- Create: `tests/shuihuo-model-center-smoke.test.js`

- [ ] **Step 1: Add a no-real-provider smoke test**

Start a fake provider and assert this sequence: admin creates disabled image model, admin validates/enables it, public list includes it, user submits `modelId`, Go sends the rendered request to the fake server, response mapping stores the result, and the task history records `modelId` plus version. The test must set credentials through an in-memory resolver.

- [ ] **Step 2: Run all targeted checks**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./...
cd ..
node --test tests/shuihuo-model-center-smoke.test.js tests/shuihuo-model-catalog-contract.test.js tests/shuihuo-model-execution-contract.test.js tests/shuihuo-gateway.test.js
npm --prefix frontend run build
git diff --check
```

Expected: all targeted tests pass, frontend build passes, and `git diff --check` is clean. A real provider request is not part of this verification.

- [ ] **Step 3: Verify local HTTP and browser behavior**

With the existing local services, verify:

```bash
curl -fsS http://127.0.0.1:3000/admin/shuihuo-models
curl -fsS http://127.0.0.1:4000/healthz
```

Open the admin model center and check both light and dark themes. Confirm the table has readable long IDs, the four type tabs work, `modelId` cannot be edited, credential values never appear, and the editor preview matches the public form. Do not click a real generation action.

- [ ] **Step 4: Update operations documentation and commit the rollout checks**

Document the credential reference configuration, migration order, archive semantics, fake-provider verification command, and the explicit statement that HTTP/build evidence does not prove real provider quality. Commit only `docs/shuihuo-production-operations.md` and the new smoke test.

## Final Review Checklist

- [ ] Every public generation request identifies a model by immutable `modelId`.
- [ ] Existing numeric model references still resolve without duplicating configuration.
- [ ] `enabled=false` blocks all new submissions; hidden models are not directly guessable from the browser.
- [ ] `uiSchema` drives React controls, Go normalization, and Go whitelist validation.
- [ ] Templates support typed tokens, paths, arrays, `$map`, `$concat`, `$if`, and `{}` input forwarding.
- [ ] Credentials come only from the server registry and are redacted from all persisted/output surfaces.
- [ ] Sync and polling execution have distinct tests and error boundaries.
- [ ] Upstream attempt markers, leases, CAS finalization, and stale-task recovery prevent unsafe duplicate work.
- [ ] Import/export is versioned, credential-free, and transactional.
- [ ] Admin UI matches the accepted high-density table reference and remains readable in both themes.
- [ ] No unrelated dirty-worktree files are staged or reverted.
