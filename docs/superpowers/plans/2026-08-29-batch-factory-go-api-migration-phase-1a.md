# Batch Factory Go API Migration Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Batch Factory production-settings validation, video-model canonicalization, and sparse override normalization from Node/Express into Go while keeping the current React UI and Node file-backed persistence working as a temporary compatibility checkpoint.

**Architecture:** This is an intentionally small vertical slice. Go becomes the authority for settings rules and model capability checks through authenticated Shuihuo Batch Factory compatibility endpoints. Node keeps only the existing HTTP route and file-backed write during Phase 1A, but it must delegate normalization/canonicalization to Go and stop implementing those business rules locally. Phase 1B will move persistence to Go/MySQL.

**Tech Stack:** Go 1.23, chi v5, existing Shuihuo model catalog/store, Node.js + Express compatibility gateway, React + Ant Design unchanged.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-go-api-migration-design.md`

## Global Constraints

- API / service backend target is Golang.
- Admin UI remains React + Ant Design.
- User UI remains React + Ant Design.
- No big-bang rewrite; migrate one verified slice at a time.
- Node/Express may remain only as a temporary compatibility layer and must not receive new Batch Factory business rules.
- Model IDs, model version, name, and max duration are canonicalized server-side from the Go model catalog.
- API keys and credential values never enter Batch Factory settings or browser state.
- Explicit `false` and empty-string overrides must be preserved.
- “Restore inheritance” deletes the override key instead of copying the parent value.
- Phase 1A does not migrate director, prompt compiler, production submission, merge, publish, or Batch Factory persistence.

---

### Task 1: Go settings normalization package

**Files:**
- Create: `backend/internal/shuihuo/batchfactory/settings.go`
- Create: `backend/internal/shuihuo/batchfactory/settings_test.go`

**Interfaces:**
- Consumes: plain JSON-compatible settings values from compatibility handlers.
- Produces:
  - `type Settings map[string]any`
  - `func NormalizeSettings(input, previous Settings) Settings`
  - `func NormalizeSparseOverride(input, previous Settings, inheritKeys []string) Settings`
  - `var OverrideKeys map[string]struct{}` or an equivalent private allowlist used by `NormalizeSparseOverride`.

- [ ] **Step 1: Write failing tests for unified settings defaults and explicit false values**

Create table-driven tests that assert:

```go
func TestNormalizeSettingsPreservesExplicitFalseAndSnapshotFields(t *testing.T) {
    got := NormalizeSettings(Settings{
        "aspectRatio": "16:9",
        "prefixEnabled": false,
        "injectCharacterPrompt": false,
        "qualityEnabled": false,
        "subtitlePolicy": "allow",
        "systemConfigRevision": "abc123",
        "systemConfigLabel": "配置 v6",
        "systemConfigSyncedAt": "2026-08-29T08:00:00.000Z",
        "systemPresetVersions": map[string]any{"batch-original-director": float64(3)},
    }, nil)

    if got["aspectRatio"] != "16:9" || got["prefixEnabled"] != false || got["injectCharacterPrompt"] != false || got["qualityEnabled"] != false {
        t.Fatalf("normalized settings = %#v", got)
    }
    if got["subtitlePolicy"] != "allow" || got["systemConfigRevision"] != "abc123" {
        t.Fatalf("normalized settings = %#v", got)
    }
}
```

Also cover defaults for `9:16`, `auto`, `forbid-auto-dialogue-subtitle`, boolean injections, and 10-second fallback when no valid max duration is present.

- [ ] **Step 2: Run Go package test and verify RED**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory -run TestNormalizeSettings -v
```

Expected: FAIL because the package/functions do not exist yet.

- [ ] **Step 3: Write failing sparse-override tests**

Cover all three existing Node behaviors:

```go
func TestNormalizeSparseOverrideOnlyStoresChangedAllowedFields(t *testing.T) {
    got := NormalizeSparseOverride(Settings{
        "quality": "单书画质",
        "injectCharacterPrompt": false,
        "unknown": "drop-me",
    }, nil, nil)
    // expect quality + explicit false only
}

func TestNormalizeSparseOverrideRestoreInheritanceDeletesKeys(t *testing.T) {
    got := NormalizeSparseOverride(Settings{"restriction": "新的限制"}, Settings{
        "quality": "单书画质",
        "restriction": "旧限制",
        "negativeEnabled": false,
    }, []string{"quality", "negativeEnabled"})
    // expect only restriction="新的限制"
}

func TestNormalizeSparseOverridePreservesEmptyTextAndFalse(t *testing.T) {
    got := NormalizeSparseOverride(Settings{
        "aspectRatio": "16:9",
        "quality": "",
        "qualityEnabled": false,
        "subtitlePolicy": "allow",
    }, nil, nil)
    // expect all four fields exactly
}
```

- [ ] **Step 4: Implement minimal Go normalization logic**

Implement only the current Batch Factory settings contract. Use helpers for bounded strings, booleans, positive integers, ISO timestamps, and preset-version maps. Do not introduce persistence or director behavior.

`NormalizeSettings` must normalize the same fields currently persisted by `lib/batch-factory/store.js` plus the production extras currently normalized in `routes/batch-factory-controls.js`:

```text
videoModelId
videoModelVersionId
videoModelName
maxVideoDuration
fixedSingleVideo
exactDuration
aspectRatio
prefixMode
customPrefix
prefixEnabled
style
synopsis
scriptPromptPresetId
assetPromptPresetId
injectCharacterPrompt
injectScenePrompt
injectPropPrompt
quality
qualityEnabled
restriction
restrictionEnabled
negative
negativeEnabled
subtitlePolicy
systemConfigRevision
systemConfigLabel
systemConfigSyncedAt
systemPresetVersions
```

`NormalizeSparseOverride` must accept only:

```text
aspectRatio
prefixMode
customPrefix
prefixEnabled
injectCharacterPrompt
injectScenePrompt
injectPropPrompt
quality
qualityEnabled
restriction
restrictionEnabled
negative
negativeEnabled
subtitlePolicy
```

- [ ] **Step 5: Run package tests and verify GREEN**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory -v
```

Expected: PASS with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/shuihuo/batchfactory/settings.go backend/internal/shuihuo/batchfactory/settings_test.go
git commit -m "feat: move batch factory settings rules to Go"
```

---

### Task 2: Go model canonicalization and compatibility handlers

**Files:**
- Create: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers_test.go`
- Modify: `backend/internal/httpapi/router.go`

**Interfaces:**
- Consumes:
  - `batchfactory.NormalizeSettings`
  - `batchfactory.NormalizeSparseOverride`
  - `shuihuostore.NewModels(api.deps.DB).GetEnabled(ctx, modelID)`
- Produces authenticated compatibility endpoints:
  - `POST /api/shuihuo-production/batch-factory/settings/canonicalize`
  - `POST /api/shuihuo-production/batch-factory/overrides/canonicalize`

Request/response contracts:

```json
POST /api/shuihuo-production/batch-factory/settings/canonicalize
{
  "settings": { "videoModelId": 18, "videoModelName": "browser value" },
  "previous": { "aspectRatio": "9:16" }
}

200
{
  "settings": {
    "videoModelId": 18,
    "videoModelVersionId": 42,
    "videoModelName": "server catalog name",
    "maxVideoDuration": 15
  }
}
```

```json
POST /api/shuihuo-production/batch-factory/overrides/canonicalize
{
  "settings": { "qualityEnabled": false },
  "previous": { "quality": "8K" },
  "inheritKeys": ["quality"]
}

200
{ "settings": { "qualityEnabled": false } }
```

- [ ] **Step 1: Write failing handler tests for auth and model authority**

Use `bridgeRequest`/`newShuihuoTestAPI` patterns from `shuihuo_handlers_test.go`.

Tests must prove:

1. unauthenticated canonicalization is rejected with `401`;
2. invalid JSON returns `400`;
3. absent/invalid video model returns `400` or `409` before returning settings;
4. a valid text-to-video model returns server-side `id/versionId/name/maxVideoDuration` rather than trusting browser-supplied values;
5. image-to-video models are rejected for this Batch Factory path;
6. role-restricted/hidden/unavailable models are rejected;
7. a model without declared max duration is rejected.

Use the existing SQL test driver helpers in `shuihuo_handlers_test.go` rather than introducing a new database mocking dependency.

- [ ] **Step 2: Run handler test and verify RED**

Run:

```bash
cd backend && go test ./internal/httpapi -run 'TestBatchFactorySettingsCanonicalize|TestBatchFactoryOverrideCanonicalize' -v
```

Expected: FAIL because routes/handlers do not exist.

- [ ] **Step 3: Implement canonical settings handler**

Implementation order:

```go
func (api *API) handleCanonicalizeBatchFactorySettings(w http.ResponseWriter, r *http.Request) {
    // require configured DB
    // decode settings + previous
    // merge previous + input
    // parse videoModelId
    // load enabled model from Go model store
    // require video kind, non-image-input, role access, provider configured, max duration 1..60
    // overwrite model snapshot fields from model definition
    // call batchfactory.NormalizeSettings
    // return {"settings": normalized}
}
```

Status rules:

```text
400 malformed settings / missing model id
403 model role restriction
409 missing, hidden, disabled, image-input, provider-unconfigured, or duration-unconfigured model
500 model catalog read failure
503 missing database
```

Do not return credential refs, endpoints, templates, or secrets.

- [ ] **Step 4: Implement sparse override handler**

The override endpoint does not need model lookup. It calls `NormalizeSparseOverride` and returns the resulting object. It must preserve explicit false and empty text and delete `inheritKeys`.

- [ ] **Step 5: Register both endpoints in `router.go`**

Add inside the existing `requirePlatformAuth` group adjacent to other Batch Factory Shuihuo endpoints:

```go
r.Post("/shuihuo-production/batch-factory/settings/canonicalize", api.handleCanonicalizeBatchFactorySettings)
r.Post("/shuihuo-production/batch-factory/overrides/canonicalize", api.handleCanonicalizeBatchFactoryOverride)
```

- [ ] **Step 6: Run focused Go tests and verify GREEN**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory ./internal/httpapi -run 'BatchFactory|Normalize' -v
```

Expected: PASS with 0 failures.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go backend/internal/httpapi/shuihuo_batch_factory_settings_handlers_test.go
git commit -m "feat: add Go batch factory settings canonicalization API"
```

---

### Task 3: Convert Node controls into a compatibility delegate

**Files:**
- Modify: `routes/batch-factory-controls.js`
- Modify: `test/batch-factory-overrides.test.js`
- Create: `test/batch-factory-go-settings-bridge.test.js`

**Interfaces:**
- Consumes existing `requestProductionBridge` from `lib/batch-factory/production-bridge.js`.
- Calls:
  - `/api/shuihuo-production/batch-factory/settings/canonicalize`
  - `/api/shuihuo-production/batch-factory/overrides/canonicalize`
- Keeps existing browser-facing routes unchanged for Phase 1A:
  - `PUT /api/batch-factory/batches/:batchId/settings`
  - `PUT /api/batch-factory/batches/:batchId/items/:itemId/overrides`
  - `PUT /api/batch-factory/batches/:batchId/items/:itemId/videos/:videoId/overrides`

- [ ] **Step 1: Write failing Node bridge test**

The test must construct `createBatchFactoryControlsRouter` with a fake `requestSettingsCanonicalizer` dependency or equivalent injectable function and assert that unified settings are persisted exactly from the returned Go `settings` object.

Desired call payload:

```js
{
  settings: { ...batch.settings, ...input },
  previous: batch.settings || {}
}
```

For overrides:

```js
{
  settings: input,
  previous: item.settingsOverride || {},
  inheritKeys
}
```

The test must also prove the route propagates the Go HTTP status and error message instead of falling back to local normalization.

- [ ] **Step 2: Run Node bridge test and verify RED**

Run:

```bash
node --test test/batch-factory-go-settings-bridge.test.js
```

Expected: FAIL because controls still normalize locally.

- [ ] **Step 3: Add one compatibility helper around `requestProductionBridge`**

Use a small function in `routes/batch-factory-controls.js`:

```js
async function canonicalizeWithGo(req, shuihuoGateway, pathname, body) {
  const upstream = await requestProductionBridge({
    username: req.auth.account.username,
    isOwner: req.auth.account.isOwner === true,
    pathname,
    body,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const error = new Error(upstream.payload?.error || 'Go 设置服务返回错误');
    error.statusCode = upstream.statusCode;
    throw error;
  }
  return upstream.payload?.settings || {};
}
```

Allow test injection without changing production call sites materially.

- [ ] **Step 4: Replace local unified-settings business logic**

The `PUT /batches/:batchId/settings` route must no longer call:

```text
resolveBoundVideoSettings
store.normalizeSettings
normalizeProductionExtras
```

Instead it sends the merged settings to Go and persists the exact canonical response into the existing Node batch store.

This persistence remains temporary compatibility state for Phase 1A; business normalization now belongs to Go.

- [ ] **Step 5: Replace local book/VIDEO override normalization**

Both override routes must call the Go sparse-override endpoint and persist the exact returned object.

- [ ] **Step 6: Remove exported local settings rule helpers no longer used by Batch Factory**

Remove `normalizeProductionExtras`, `normalizeSparseOverride`, `SCRIPT_PROMPT_PRESETS`, and `ASSET_PROMPT_PRESETS` from module exports after tests have moved to Go/bridge behavior. Keep `normalizePublishSettings` because publish settings are explicitly outside Phase 1A.

Do not remove source-edit behavior or publish-settings behavior.

- [ ] **Step 7: Run Node regression tests**

Run:

```bash
node --test test/batch-factory-go-settings-bridge.test.js
node --test test/batch-factory-overrides.test.js
node --test test/batch-factory-settings-inheritance.test.js
node --test test/batch-factory.test.js
```

Expected: all pass. The old direct-unit sparse-override tests should either be converted to bridge contract tests or removed only after equivalent Go tests exist.

- [ ] **Step 8: Commit**

```bash
git add routes/batch-factory-controls.js test/batch-factory-go-settings-bridge.test.js test/batch-factory-overrides.test.js
git commit -m "refactor: delegate batch factory settings rules to Go"
```

---

### Task 4: Branch CI and verification checkpoint

**Files:**
- Modify: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- Produces repeatable CI evidence for Phase 1A on branch `10-batch-factory-go-api-migration`.

- [ ] **Step 1: Add branch trigger and Go setup**

Add the branch:

```yaml
- 10-batch-factory-go-api-migration
```

Add Go setup:

```yaml
- name: Setup Go
  uses: actions/setup-go@v5
  with:
    go-version: '1.23'
```

- [ ] **Step 2: Add focused Go verification before Node regression**

```yaml
- name: Test Go Batch Factory settings boundary
  run: go test ./internal/shuihuo/batchfactory ./internal/httpapi
  working-directory: backend
```

Keep the existing Node Batch Factory tests and React production build.

- [ ] **Step 3: Push CI-only change and inspect RED/GREEN as appropriate**

The workflow must run against the exact branch HEAD and execute both Go and Node tests.

- [ ] **Step 4: Full verification before claiming Phase 1A complete**

Required evidence:

```text
Go batchfactory package: PASS
Go httpapi package: PASS
Node config-version tests: PASS
Node sparse/bridge tests: PASS
Node settings inheritance tests: PASS
Node Batch Factory regression: PASS
React Vite production build: PASS
```

- [ ] **Step 5: Diff review**

Compare `09-batch-factory-video-model-selector...10-batch-factory-go-api-migration` and verify this checkpoint changes only:

```text
Go settings normalization
Go settings compatibility handlers/tests
Node compatibility delegation/tests
Batch Factory CI
migration docs/plan
```

No director, prompt compiler, production, merge, publish, or unrelated frontend behavior should change.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/batch-factory-verify.yml
git commit -m "ci: verify Go batch factory settings migration"
```

---

## Phase 1A Completion Boundary

Phase 1A is complete only when the running settings flow is:

```text
React + Ant Design
  -> existing /api/batch-factory compatibility route
  -> Node authentication / temporary file-backed write only
  -> Go canonicalization API
     -> Go model catalog / capability checks
     -> Go settings + override normalization rules
```

At this checkpoint Node still holds the temporary batch file because persistence migration is deliberately deferred. It must no longer decide which model is valid, what max duration is, how unified settings are normalized, or how sparse inheritance overrides are normalized.

Phase 1B will add Go/MySQL Batch Factory settings persistence and then remove the temporary Node settings write path.
