# Shuihuo Direct Smart Assets And Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace candidate review with direct asset extraction, safe replacement of the current AI set, retained image history, and per-asset prompt regeneration.

**Architecture:** An asset has `is_current`; historical assets with images remain in storage and right-side libraries. Generated images hold immutable name/category/prompt snapshots. Go owns replacement and regeneration transactions; Node continues resolving published server prompt bodies.

**Tech Stack:** React/Ant Design, Express, Go/chi, MySQL migrations, Node test runner, Go testing.

---

### Task 1: Persist Current State And Image Prompt Snapshots

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go:122-155`
- Modify: `backend/internal/storage/migrations.go:240-309`
- Test: `backend/internal/storage/migrations_test.go`

- [ ] **Step 1: Write a failing migration test**

```go
func TestShuihuoAssetHistoryMigration(t *testing.T) {
    migration := migrationForVersion(t, 26)
    for _, required := range []string{
        "ADD COLUMN is_current",
        "asset_name_snapshot",
        "asset_category_snapshot",
        "asset_prompt_snapshot",
    } {
        if !strings.Contains(migration.sql, required) {
            t.Fatalf("migration SQL missing %q", required)
        }
    }
}
```

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/storage -run TestShuihuoAssetHistoryMigration -count=1`

Expected: FAIL because migration 26 is absent.

- [ ] **Step 3: Implement migration 26 and domain fields**

Add `IsCurrent bool \`json:"isCurrent"\`` to `domain.Asset`. Add `AssetNameSnapshot string \`json:"assetNameSnapshot"\``, `AssetCategorySnapshot string \`json:"assetCategorySnapshot"\``, and `AssetPromptSnapshot string \`json:"assetPromptSnapshot"\`` to `domain.AssetImage`.

Migration 26 adds `is_current BOOLEAN NOT NULL DEFAULT TRUE` with a project/current index, and the three non-null snapshot columns on `shuihuo_asset_images`. It backfills existing images from their referenced asset. Image creation persists the asset values present at submission.

- [ ] **Step 4: Verify GREEN and commit**

Run: `go test ./internal/storage -run TestShuihuoAssetHistoryMigration -count=1`

Expected: PASS.

Commit: `git add backend/internal/shuihuo/domain/types.go backend/internal/storage/migrations.go backend/internal/storage/migrations_test.go && git commit -m "feat: retain historical Shuihuo asset images"`

### Task 2: Replace Only Current Unedited AI Assets

**Files:**
- Modify: `backend/internal/shuihuo/store/assets.go:20-145`
- Modify: `backend/internal/shuihuo/store/asset_images.go:16-112`
- Modify: `backend/internal/shuihuo/store/source_units.go:525-560`
- Test: `backend/internal/shuihuo/store/assets_test.go`

- [ ] **Step 1: Write failing store tests**

```go
func TestAssetsReplaceCurrentAICandidatesArchivesImagedAssets(t *testing.T) {
    // An unedited ai_candidate with images becomes is_current = false.
    // An unedited ai_candidate without images is deleted.
    // Manual and manually edited assets remain is_current = true.
}

func TestAssetsLibraryIncludesHistoricalImagesButProjectReadOmitsHistoricalAssets(t *testing.T) {
    // The left list sees current assets only; the right library includes image
    // records from current and historical assets with their snapshots.
}
```

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/shuihuo/store -run 'TestAssets(ReplaceCurrentAICandidates|LibraryIncludesHistoricalImages)' -count=1`

Expected: FAIL because current/history behavior does not exist.

- [ ] **Step 3: Implement one transactional store operation**

Add `ReplaceCurrentAICandidates(ctx, ownerID, projectID, candidates)`:

```go
// Lock the owned project and remove bindings for retiring assets.
// Retire source=ai_candidate, manually_edited=false, is_current=true assets.
// Archive assets having images; delete assets without images.
// Insert validated replacements with source ai_candidate and is_current=true.
// Commit only if every retire and insert succeeds.
```

Filter `ListByProject`, project read models, and segment asset queries to `is_current = TRUE`. Add `AssetImages.ListLibraryByProject` with account/project/category ownership filtering and image snapshots.

- [ ] **Step 4: Verify GREEN and commit**

Run: `go test ./internal/shuihuo/store -run 'TestAssets(ReplaceCurrentAICandidates|LibraryIncludesHistoricalImages)' -count=1`

Expected: PASS.

Commit: `git add backend/internal/shuihuo/store/assets.go backend/internal/shuihuo/store/asset_images.go backend/internal/shuihuo/store/source_units.go backend/internal/shuihuo/store/assets_test.go && git commit -m "feat: replace current Shuihuo AI asset set safely"`

### Task 3: Make Full Analysis Persist Directly And Regenerate One Asset

**Files:**
- Modify: `backend/internal/httpapi/router.go:86-101`
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go:18-221`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: Write failing handler tests**

```go
func TestAssetAnalysisReplacesCurrentAICandidatesAndReturnsAssets(t *testing.T) {}
func TestRegenerateAssetPromptReplacesOnlyRequestedAsset(t *testing.T) {}
func TestRegenerateAssetPromptRejectsCrossProjectAsset(t *testing.T) {}
```

The first stubs text completion and asserts a single POST saves and returns current assets. The second asserts only the named asset prompt changes and image rows stay unchanged. The third asserts another project's asset cannot be regenerated.

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/httpapi -run 'Test(AssetAnalysisReplacesCurrentAICandidatesAndReturnsAssets|RegenerateAssetPrompt)' -count=1`

Expected: FAIL because analysis is candidate-only and the regeneration route is absent.

- [ ] **Step 3: Implement the direct routes**

Change `handleShuihuoAssetAnalysis` to parse candidates and call `ReplaceCurrentAICandidates`, returning `{ "assets": [...] }`. Add `POST /api/shuihuo-production/projects/{id}/assets/{assetId}/prompt/regenerate`: load the owned current asset, combine the published system prompt, project source, asset name/category/current prompt, require exactly one same-category candidate, then update only `asset.Prompt`. Do not update images, bindings, or other assets. Add `GET /projects/{id}/asset-image-library?category=` backed by `ListLibraryByProject`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `go test ./internal/httpapi -run 'Test(AssetAnalysisReplacesCurrentAICandidatesAndReturnsAssets|RegenerateAssetPrompt)' -count=1`

Expected: PASS.

Commit: `git add backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_analysis_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go && git commit -m "feat: generate and regenerate Shuihuo asset prompts directly"`

### Task 4: Preserve Published-Prompt Gateway Ownership

**Files:**
- Modify: `routes/shuihuo-production.js:57-123`
- Test: `tests/shuihuo-gateway.test.js`

- [ ] **Step 1: Write a failing gateway test**

```js
test('asset prompt regeneration uses the published extraction preset and text timeout', () => {
  const path = '/api/shuihuo-production/projects/12/assets/34/prompt/regenerate';
  const body = systemPromptBodyForRequest(path, { modelId: 7, assetPresetId: 'custom-assets', systemPrompt: 'browser prompt' }, presetStore);
  assert.equal(body.systemPromptId, 'custom-assets');
  assert.doesNotMatch(body.systemPrompt, /browser prompt/);
  assert.equal(upstreamTimeoutForRequest('POST', path), 100_000);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern 'asset prompt regeneration' tests/shuihuo-gateway.test.js`

Expected: FAIL because the regeneration path is not recognized.

- [ ] **Step 3: Implement gateway recognition**

Route the regeneration pathname through `createScopedAssetAnalysisBody()` and grant it the 100-second text-model timeout. Leave all wrong-slot and unpublished preset rejection intact.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/shuihuo-gateway.test.js`

Expected: PASS.

Commit: `git add routes/shuihuo-production.js tests/shuihuo-gateway.test.js && git commit -m "feat: route Shuihuo prompt regeneration through presets"`

### Task 5: Replace The Candidate Modal With Direct UI Actions

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js:27-46`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx:1-280`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/shuihuo-production-ui-contract.test.js`
- Create: `tests/shuihuo-direct-assets.test.mjs`

- [ ] **Step 1: Write failing frontend tests**

```js
test('smart preset refreshes saved assets without candidate apply UI', () => {
  assert.doesNotMatch(source, /AI 资产分析候选|applyAssetCandidates/);
  assert.match(source, /await analyzeAssets\(data\.project\.id/);
  assert.match(source, /await onRefresh\(\)/);
});
test('asset cards expose per-item prompt regeneration', () => {
  assert.match(source, /regenerateAssetPrompt\(data\.project\.id, asset\.id/);
  assert.match(source, /重生/);
});
test('historical image cards open the asset editor', () => {
  assert.match(source, /asset-image-library/);
  assert.match(source, /setEditing\(/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-direct-assets.test.mjs`

Expected: FAIL because the candidate modal remains and the API helpers are absent.

- [ ] **Step 3: Implement direct and historical UI**

Add `regenerateAssetPrompt(projectId, assetId, payload)` and `listAssetImageLibrary(projectId, category)` API helpers. Make toolbar `智能预设` validate model/preset, call direct analysis, and refresh. Remove candidate state, modal, and `applyAssetCandidates`. Add a loading `重生` action per non-voice asset card. Render right image libraries from the library API with snapshot text; clicking a current or historical card calls `setEditing(libraryItem.asset)` and opens the existing editor. Historical cards remain right-only.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-direct-assets.test.mjs && npm --prefix frontend run build`

Expected: all tests PASS and Vite exits 0.

Commit: `git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/AssetsView.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-production-ui-contract.test.js tests/shuihuo-direct-assets.test.mjs && git commit -m "feat: simplify Shuihuo smart asset workflow"`

### Task 6: Integrate And Verify Local Services

**Files:**
- Modify: only a Task 1-5 file if verification exposes a concrete defect

- [ ] **Step 1: Run focused verification**

Run: `go test ./internal/storage ./internal/shuihuo/store ./internal/httpapi && node --test tests/shuihuo-gateway.test.js tests/shuihuo-production-ui-contract.test.js tests/shuihuo-direct-assets.test.mjs && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 2: Rebuild and restart the Go backend**

Run: `cd backend && go build -o .qiantie-backend-server ./cmd/qiantie && launchctl kickstart -k gui/$(id -u)/com.ming.qiantie-backend && curl -sS --fail http://127.0.0.1:4000/healthz`

Expected: `{"ok":true}` and migration 26 applies.

- [ ] **Step 3: Restart gateway and verify authenticated UI without a paid request**

Run: `launchctl kickstart -k gui/$(id -u)/com.ming.qiantie && curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/shuihuo-production`

Expected: `200`. In the existing logged-in browser verify the candidate modal is gone, direct loading exists, left list filters to current assets, and a historical right-side image opens the editor. Do not submit a real model request without the user's cost approval.
