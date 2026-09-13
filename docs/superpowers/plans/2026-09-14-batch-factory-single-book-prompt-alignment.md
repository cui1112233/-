# Batch Factory V11 Single-Book Prompt Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Batch Factory book use the same published character/scene extraction protocol as script generation, with typed prompt selections, real single-book overrides, persisted assets, and correct image/VIDEO inputs.

**Architecture:** Node remains the trusted preset resolver between the browser and the Go V11 service. The browser submits selection metadata only; Node validates the selected published preset against a fixed module/slot contract, injects a protected execution snapshot for Go, and removes all prompt bodies from responses. Go resolves batch/book/video settings, stores the frozen configuration with director revisions, and compiles image and video inputs from the actual per-book asset records.

**Tech Stack:** React 18, Ant Design, Node/Express, Go, MySQL/Goose, Redis queue, TOS object storage, Node test runner, Go test.

## Global Constraints

- Implement only on branch `v88`; do not write to old `v78`.
- Browser requests contain preset ID, name, version and slot metadata only; system Prompt bodies stay server-side.
- Batch Factory reuses published `script` extraction presets with `kind=base` and `extractionPreset=true`; it does not duplicate them into `batch-factory`.
- Batch Factory video, image, asset and constraint selections must use their exact published module/slot contract; invalid selections return 422.
- Effective configuration is `batch → book → VIDEO`; each lower layer stores only changed fields.
- `visualPrompt` is only an image-generation input and must never enter a VIDEO prompt.
- Existing image assets win over text; text is a fallback only when no usable image is sent or capability limits exclude an image.
- No UI may claim generation, upload, replacement or 121 submission succeeded without a provider receipt and persisted readback.

---

## File Structure

- `lib/system-preset-catalog.js`: owns fixed preset-slot definitions and the public catalog metadata.
- `routes/batch-factory-v11.js`: validates browser preset selections, injects protected prompt snapshots into V11 requests, and redacts responses.
- `routes/batch-factory-v11.test.js`: Node contract tests for module/slot validation and prompt redaction.
- `backend/internal/batchfactoryv11/director_contract.go`: typed effective AI rule contract and system prompt composition.
- `backend/internal/batchfactoryv11/director_service.go`: single-book asset extraction and director execution using frozen settings.
- `backend/internal/batchfactoryv11/types.go`: typed asset records, snapshots and store interfaces.
- `backend/internal/batchfactoryv11/director_store_mysql.go`: persists per-book assets, revision snapshots and ownership checks.
- `backend/internal/storage/batch_factory_v11_schema.go`: Goose migration registration for asset/media tables.
- `backend/internal/httpapi/batch_factory_v11_assets.go`: authenticated book-asset and image routes.
- `backend/internal/httpapi/router.go`: registers the asset routes behind the existing V11 bridge authentication.
- `frontend/src/shared/api/batchFactoryV11.js`: typed calls for preset catalogs, book overrides, assets and image versions.
- `frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx`: typed AI rule selectors; no cross-slot dropdown.
- `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`: one-book modal with inherited/effective settings, assets and image actions.
- `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx`: isolated single-book override editor.
- `frontend/src/user/pages/shuihuo/BatchFactoryAssetEditor.jsx`: isolated character/scene/prop Prompt and image workbench.

## Task 1: Define the preset-slot contract

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Create: `lib/system-preset-catalog.test.js`

**Interfaces:**
- Produces `BATCH_FACTORY_PRESET_REQUIREMENTS`, keyed by `assets.extraction`, `assets.character`, `assets.scene`, `assets.prop`, `constraints`, `video`, `visual`.
- Produces `isPublishedPresetAllowed(preset, requirement)` returning a boolean.

- [ ] **Step 1: Write the failing Node tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_FACTORY_PRESET_REQUIREMENTS, isPublishedPresetAllowed } from './system-preset-catalog.js';

test('Batch Factory extraction accepts a published script extraction preset only', () => {
  assert.equal(isPublishedPresetAllowed(
    { module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), true);
  assert.equal(isPublishedPresetAllowed(
    { module: 'batch-factory', kind: 'base', protocolLock: { slot: 'batch.character-meta' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), false);
});

test('Batch Factory character and scene rules reject each other', () => {
  const character = { module: 'batch-factory', kind: 'base', protocolLock: { slot: 'batch.character-meta' } };
  assert.equal(isPublishedPresetAllowed(character, BATCH_FACTORY_PRESET_REQUIREMENTS['assets.character']), true);
  assert.equal(isPublishedPresetAllowed(character, BATCH_FACTORY_PRESET_REQUIREMENTS['assets.scene']), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/system-preset-catalog.test.js`

Expected: FAIL because the requirement catalog and validator do not exist.

- [ ] **Step 3: Implement the requirement catalog**

Add the following exported contract after `SYSTEM_PRESET_SLOTS`:

```js
const BATCH_FACTORY_PRESET_REQUIREMENTS = Object.freeze({
  'assets.extraction': Object.freeze({ module: 'script', kind: 'base', extractionPreset: true, format: 'extract' }),
  'assets.character': Object.freeze({ module: 'batch-factory', kind: 'base', slot: 'batch.character-meta' }),
  'assets.scene': Object.freeze({ module: 'batch-factory', kind: 'base', slot: 'batch.scene-meta' }),
  'assets.prop': Object.freeze({ module: 'batch-factory', kind: 'base', slot: 'batch.prop-meta' }),
  constraints: Object.freeze({ module: 'script', kind: 'addon', format: 'constraint' }),
  video: Object.freeze({ module: 'batch-factory', kind: 'base', slot: 'batch.video-meta' }),
  visual: Object.freeze({ module: 'batch-factory', kind: 'base', slot: 'batch.visual-meta' })
});

function isPublishedPresetAllowed(preset, requirement) {
  if (!preset || !requirement || preset.module !== requirement.module || preset.kind !== requirement.kind) return false;
  if (requirement.extractionPreset && preset.extractionPreset !== true) return false;
  if (requirement.format && preset.protocolLock?.format !== requirement.format) return false;
  return !requirement.slot || preset.protocolLock?.slot === requirement.slot;
}
```

Add `batch.prop-meta` and `batch.visual-meta` as fixed Batch Factory slots and seed their published system presets with separate source files. Do not reuse the character or video slot for them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/system-preset-catalog.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/system-preset-catalog.js lib/system-preset-catalog.test.js prompts/批量工厂-道具提示词.md prompts/批量工厂-画面提示词.md
git commit -m "feat: define typed batch factory preset slots"
```

## Task 2: Validate and freeze selected preset bodies at the Node-to-Go boundary

**Files:**
- Modify: `routes/batch-factory-v11.js`
- Create: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Consumes `BATCH_FACTORY_PRESET_REQUIREMENTS` and `isPublishedPresetAllowed` from Task 1.
- Produces `enrichBatchFactorySystemPresetConfig(input, presetStore)` with a protected `body` snapshot for each selection.
- Produces `redactBatchFactorySystemPromptBodies(value)` that removes every `body` value recursively from browser responses.

- [ ] **Step 1: Write failing router-contract tests**

```js
test('enrichment rejects a scene preset selected as the character rule', () => {
  const input = { patch: { aiPromptConfig: { assets: { character: { presetId: 'batch-scene-meta' } } } } };
  assert.throws(() => enrichBatchFactorySystemPresetConfig(input, presetStore), /人物.*预设词/);
});

test('enrichment snapshots a script extraction preset without exposing its body', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: { aiPromptConfig: { assets: { extraction: { presetId: 'script-extract' } } } }
  }, presetStore);
  assert.equal(enriched.patch.aiPromptConfig.assets.extraction.body.includes('人物'), true);
  assert.equal(redactBatchFactorySystemPromptBodies(enriched).patch.aiPromptConfig.assets.extraction.body, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test routes/batch-factory-v11.test.js`

Expected: FAIL because the current `assets` field accepts an arbitrary Batch Factory preset and does not accept a script extraction preset.

- [ ] **Step 3: Replace the generic module loop with typed selection resolution**

Use this configuration shape:

```js
aiPromptConfig: {
  assets: {
    extraction: { presetId, presetName, presetSlot, presetVersion, body },
    character: { presetId, presetName, presetSlot, presetVersion, body },
    scene: { presetId, presetName, presetSlot, presetVersion, body },
    prop: { presetId, presetName, presetSlot, presetVersion, body },
    scope: 'all' | 'unfinished' | 'custom',
    bookIds: []
  },
  constraints: { enabled, selections: [{ presetId, presetName, presetSlot, presetVersion, body }], scope, bookIds },
  video: { enabled, presetId, presetName, presetSlot, presetVersion, body, fixedSingleVideo, scope, bookIds },
  visual: { enabled, presetId, presetName, presetSlot, presetVersion, body, scope, bookIds }
}
```

Resolve each selected ID with `presetStore.getPublished`, validate it against its required contract, set canonical metadata from the published record, then add the protected `body`. Remove browser-supplied `body`, legacy `prompt` and arbitrary slot/name/version values before resolution.

- [ ] **Step 4: Run the router tests**

Run: `node --test routes/batch-factory-v11.test.js lib/system-preset-catalog.test.js`

Expected: PASS; invalid module/slot selections return the typed 422 error and protected bodies never survive response redaction.

- [ ] **Step 5: Commit**

```bash
git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js
git commit -m "fix: validate and freeze batch factory prompt selections"
```

## Task 3: Make the Go director use the frozen typed rules

**Files:**
- Modify: `backend/internal/batchfactoryv11/director_contract.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/director_service_test.go`

**Interfaces:**
- Consumes protected selection bodies supplied by Task 2.
- Produces `AIReasoningPromptConfig` with `Assets.Extraction`, `Assets.Character`, `Assets.Scene`, `Assets.Prop`, `Constraints.Selections`, `Video`, and `Visual`.
- Produces `BuildDirectorContract(book, hook, snapshot)` with distinct character, scene, prop, video and visual instructions.

- [ ] **Step 1: Write failing Go tests**

```go
func TestBuildDirectorContractUsesScriptExtractionAndTypedAssetRules(t *testing.T) {
    contract, err := BuildDirectorContract(book, HookRevision{}, DirectorSnapshot{Mode: "original", MaxVideoDuration: 15, AspectRatio: "9:16", Effective: rawConfig(t, map[string]any{
        "aiPromptConfig": map[string]any{"assets": map[string]any{
            "extraction": map[string]any{"enabled": true, "body": "SCRIPT EXTRACTION"},
            "character": map[string]any{"enabled": true, "body": "CHARACTER ONLY"},
            "scene": map[string]any{"enabled": true, "body": "SCENE ONLY"},
        }},
    })})
    if err != nil { t.Fatal(err) }
    if !strings.Contains(contract.SystemPrompt, "SCRIPT EXTRACTION") || !strings.Contains(contract.SystemPrompt, "CHARACTER ONLY") || !strings.Contains(contract.SystemPrompt, "SCENE ONLY") { t.Fatal(contract.SystemPrompt) }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/batchfactoryv11 -run TestBuildDirectorContractUsesScriptExtractionAndTypedAssetRules -count=1`

Expected: FAIL because `AIReasoningPromptConfig.Assets` has only one generic `Prompt`.

- [ ] **Step 3: Implement typed contract assembly**

Define a selection structure that retains metadata and `Body` only in the Go request/snapshot:

```go
type PresetSnapshot struct {
    ID string `json:"presetId"`
    Name string `json:"presetName"`
    Slot string `json:"presetSlot"`
    Version int `json:"presetVersion"`
    Body string `json:"body"`
}
```

Append asset instructions with explicit boundaries:

```go
rules = append(rules,
  "人物/场景提取方案：只提取实际出现的人物与场景。\n"+config.Assets.Extraction.Body,
  "人物资产规则：只约束 characters 的 prompt。\n"+config.Assets.Character.Body,
  "场景资产规则：只约束 scenes 的 prompt。\n"+config.Assets.Scene.Body,
  "道具资产规则：只约束 props 的 prompt。\n"+config.Assets.Prop.Body,
)
```

Only append a rule whose selection is enabled, in scope for the book, and has non-empty `Body`. Preserve the existing visual rule that requires `visual_prompt` but does not append it to `video_desc`.

- [ ] **Step 4: Run focused and package tests**

Run: `go test ./internal/batchfactoryv11 -run 'TestBuildDirectorContract|TestDirector' -count=1 && go test ./internal/batchfactoryv11 -count=1`

Expected: PASS; existing generic prompt tests are rewritten to assert the typed boundaries.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/batchfactoryv11/director_contract.go backend/internal/batchfactoryv11/director_service.go backend/internal/batchfactoryv11/director_service_test.go
git commit -m "feat: apply typed prompt rules in batch director"
```

## Task 4: Add visible, durable single-book overrides

**Files:**
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`

**Interfaces:**
- Consumes `saveBookOverride(batchId, bookId, { patch, expectedRevision })`.
- Produces a sparse `SettingsPatch` containing only values changed from the effective batch settings.
- Produces `GET effective-settings` readback with `values` and `sourceByField` for the selected book/VIDEO.

- [ ] **Step 1: Write the failing UI and API tests**

```js
test('book settings saves only fields changed from inherited values', () => {
  assert.deepEqual(buildBookOverridePatch({ textModelId: 'text-a', aspectRatio: '9:16' }, { textModelId: 'text-a', aspectRatio: '16:9' }), { aspectRatio: '16:9' });
});
```

```go
func TestBookOverrideDoesNotChangeBatchSettings(t *testing.T) {
    // save a book textModelId and assert the batch patch remains unchanged
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js && go test ./internal/httpapi -run TestBookOverrideDoesNotChangeBatchSettings -count=1`

Expected: FAIL because no single-book modal or sparse-diff helper exists.

- [ ] **Step 3: Implement the single-book modal and readback**

The modal must show two sections:

```text
继承状态：文本模型 ← 作品统一配置
覆盖当前书：文本模型 [选择已授权文本模型]
```

It exposes typed prompt selections from Task 2 and image/text/video model selectors from the existing model catalog. On save, compare the edited fields with the batch effective values, omit equal fields, and send the remaining patch to `PUT /batches/{batchId}/books/{bookId}/override` with the book revision. The workbench row opens this modal from a “单书配置” action and refreshes the book from the returned batch.

- [ ] **Step 4: Run tests and build**

Run: `node --test src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js && go test ./internal/httpapi -run TestBookOverrideDoesNotChangeBatchSettings -count=1 && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx backend/internal/httpapi/batch_factory_v11_slice1_test.go
git commit -m "feat: add batch factory single-book overrides"
```

## Task 5: Persist and edit actual per-book assets

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/memory_store.go`
- Modify: `backend/internal/batchfactoryv11/director_store_mysql.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Create: `backend/internal/httpapi/batch_factory_v11_assets.go`
- Modify: `backend/internal/httpapi/router.go`
- Create: `backend/internal/httpapi/batch_factory_v11_assets_test.go`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryAssetEditor.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`

**Interfaces:**
- Produces `ListBookAssets`, `UpdateBookAsset`, and `CreateBookAsset` methods scoped by owner, batch ID and book ID.
- Produces `/batches/{batchId}/books/{bookId}/assets` GET/POST and `/assets/{assetId}` PATCH routes.
- Replaces inline draft-only editing with persisted book asset records.

- [ ] **Step 1: Write failing ownership and persistence tests**

```go
func TestBookAssetUpdatePersistsAndIsOwnerScoped(t *testing.T) {
    created := postAsset(t, "alice", batch.ID, book.ID, `{"kind":"character","name":"林晚","prompt":"旧 Prompt"}`)
    patchAsset(t, "alice", batch.ID, book.ID, created.ID, `{"prompt":"新 Prompt"}`)
    assertBookAssetPrompt(t, "alice", batch.ID, book.ID, created.ID, "新 Prompt")
    mustStatus(t, patchAsset(t, "bob", batch.ID, book.ID, created.ID, `{"prompt":"越权"}`), http.StatusNotFound)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/httpapi -run TestBookAssetUpdatePersistsAndIsOwnerScoped -count=1`

Expected: FAIL because V11 has no book-asset CRUD route.

- [ ] **Step 3: Add the asset data model and migration**

Persist each record with `id`, `owner_username`, `batch_id`, `book_id`, `kind`, `name`, `prompt`, `source`, `extraction_preset_id`, `extraction_preset_version`, `revision`, `created_at`, and `updated_at`. Add a unique `(owner_username, batch_id, book_id, kind, name)` constraint. `PersistDirectorRevision` upserts AI-extracted assets without deleting manually edited records; a user-edited asset wins unless the user explicitly regenerates it.

- [ ] **Step 4: Add API and replace draft-only editor usage**

`BatchFactoryAssetEditor` displays left-side asset prompts by kind, writes edits through `PATCH`, and reloads the same book after save. The parent modal receives only `book`, `batchId`, `effectiveEngineConfig` and `onChanged`; it does not contain production or prompt-compilation state.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/batchfactoryv11 ./internal/httpapi -run 'TestBookAsset|TestFinalPrompt' -count=1 && node --test src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: PASS; a saved asset prompt is visible after reload and used by final prompt compilation.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi/batch_factory_v11_assets.go backend/internal/httpapi/batch_factory_v11_assets_test.go backend/internal/httpapi/router.go backend/internal/storage/batch_factory_v11_schema.go frontend/src/user/pages/shuihuo/BatchFactoryAssetEditor.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx
git commit -m "feat: persist per-book batch factory assets"
```

## Task 6: Add real asset image versions and media actions

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/director_store_mysql.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_assets.go`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryAssetEditor.jsx`
- Create: `backend/internal/httpapi/batch_factory_v11_asset_images_test.go`

**Interfaces:**
- Produces asset image version endpoints: create generation task, upload image, list versions, set primary image, replace image.
- Produces `BookAssetImage{ID, AssetID, URL, Source, IsPrimary, Revision, CreatedAt}`.

- [ ] **Step 1: Write the failing image-version test**

```go
func TestBookAssetPrimaryImageSwapsWithoutDeletingThePreviousVersion(t *testing.T) {
    asset := createTestAsset(t)
    first := createImageVersion(t, asset.ID, "https://tos.example/first.png")
    second := createImageVersion(t, asset.ID, "https://tos.example/second.png")
    setPrimary(t, asset.ID, second.ID)
    images := listImages(t, asset.ID)
    assertPrimary(t, images, second.ID)
    assertVersionPresent(t, images, first.ID)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/httpapi -run TestBookAssetPrimaryImageSwapsWithoutDeletingThePreviousVersion -count=1`

Expected: FAIL because assets have no image-version persistence.

- [ ] **Step 3: Implement media persistence and provider-backed generation**

Store image versions separately from assets. Upload uses the existing object-storage upload path and writes a version only after TOS returns a URL. Generation creates a provider task, writes `pending`, then writes a real version after provider success; provider errors leave the previous primary image unchanged. `set primary` switches flags in one transaction.

- [ ] **Step 4: Implement the right-hand image library**

Show only persisted image versions. Buttons are enabled only when the matching model and endpoint capability are available. The UI displays provider failure text and keeps “生成 / 上传 / 替换” disabled when the server reports no capability; it never uses a local success message as proof.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/httpapi ./internal/batchfactoryv11 -run 'TestBookAsset.*Image|TestBookAsset' -count=1 && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi/batch_factory_v11_assets.go backend/internal/httpapi/batch_factory_v11_asset_images_test.go backend/internal/storage/batch_factory_v11_schema.go frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/shuihuo/BatchFactoryAssetEditor.jsx
git commit -m "feat: add batch factory asset image versions"
```

## Task 7: Compile correct image and VIDEO inputs from single-book assets

**Files:**
- Modify: `backend/internal/batchfactoryv11/final_prompt.go`
- Modify: `backend/internal/batchfactoryv11/production.go`
- Modify: `backend/internal/batchfactoryv11/final_prompt_test.go`
- Modify: `backend/internal/batchfactoryv11/production_test.go`

**Interfaces:**
- Consumes resolved book assets and primary image versions from Task 6.
- Produces `CompiledVideoInput{Prompt string, ReferenceImageURLs []string, DowngradedAssetIDs []string}`.

- [ ] **Step 1: Write failing compiler tests**

```go
func TestCompiledVideoInputUsesAssetImagesBeforeAssetText(t *testing.T) {
    input := compileWithAsset(t, "林晚", "人物文字 Prompt", "https://tos.example/lin.png", 3)
    if strings.Contains(input.Prompt, "人物文字 Prompt") { t.Fatal(input.Prompt) }
    if !slices.Contains(input.ReferenceImageURLs, "https://tos.example/lin.png") { t.Fatal(input.ReferenceImageURLs) }
}

func TestCompiledVideoInputUsesDroppedAssetTextWhenReferenceLimitExceeded(t *testing.T) {
    input := compileWithFiveAssetsAndLimit(t, 3)
    if !strings.Contains(input.Prompt, "手机：道具 Prompt") { t.Fatal(input.Prompt) }
    if strings.Contains(input.Prompt, "画面提示词") { t.Fatal(input.Prompt) }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/batchfactoryv11 -run 'TestCompiledVideoInput' -count=1`

Expected: FAIL because production currently compiles only textual prompts and has no typed reference-image list.

- [ ] **Step 3: Implement capability-aware compilation**

Build image inputs in this stable order: current visual image, referenced character images, scene images, then prop images. Respect the selected video model’s reference-image limit. For every excluded asset image, append that asset’s text Prompt only when non-empty; record the exclusion in the production task log. Do not append `visualPrompt` to the VIDEO text prompt under any condition.

- [ ] **Step 4: Run compiler and production tests**

Run: `go test ./internal/batchfactoryv11 -run 'TestFinalPrompt|TestCompiledVideoInput|TestProduction' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/batchfactoryv11/final_prompt.go backend/internal/batchfactoryv11/production.go backend/internal/batchfactoryv11/final_prompt_test.go backend/internal/batchfactoryv11/production_test.go
git commit -m "feat: compile batch videos from real book assets"
```

## Task 8: Full regression, UI verification and documentation audit

**Files:**
- Modify: `docs/批量工厂V11-新版布局与生产逻辑-完整.md`
- Modify: `docs/superpowers/specs/2026-09-14-batch-factory-single-book-prompt-alignment-design.md`

**Interfaces:**
- Consumes completed Tasks 1-7.
- Produces an updated V11 implementation status with links to the concrete APIs and tests.

- [ ] **Step 1: Run full automated validation**

Run:

```bash
node --test lib/system-preset-catalog.test.js routes/batch-factory-v11.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
go test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Perform authenticated browser verification**

Using a logged-in developer account, create one batch with one book; select a script extraction preset; open the book modal; run extraction; edit one character Prompt; generate/upload two asset images and select the second as primary; save a book-only text model override; reopen the book; run one VIDEO; verify the request log shows the primary image and excludes its character text Prompt; verify the final prompt contains no visual Prompt text.

- [ ] **Step 3: Update the design baseline**

Mark only verified items complete in the V11 design document. For any provider action lacking an actual receipt, retain the explicit unavailable state and the exact reason; do not mark it complete from HTTP acceptance alone.

- [ ] **Step 4: Commit**

```bash
git add docs/批量工厂V11-新版布局与生产逻辑-完整.md docs/superpowers/specs/2026-09-14-batch-factory-single-book-prompt-alignment-design.md
git commit -m "docs: record verified batch factory single-book flow"
```
