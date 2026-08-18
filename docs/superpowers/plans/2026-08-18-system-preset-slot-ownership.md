# System Preset Slot Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every system preset a stable ownership slot and let every Shuihuo project choose published character- and scene-extraction prompts.

**Architecture:** Node owns a fixed slot registry and resolves selected published prompt IDs at the gateway. Go stores only project-owned IDs and receives resolved prompt bodies. Admin UI manages a preset's slot; Shuihuo UI renders slot-filtered selections.

**Tech Stack:** Node.js, Express, React + Ant Design, Go, MySQL migrations, node:test.

---

## File Structure

- `app.js`, `lib/system-preset-catalog.js`: slot-validator wiring, registry, default slot metadata, published-slot resolver, and known built-in metadata upgrades.
- `lib/preset-store.js`: draft slot validation and public slot summaries.
- `routes/admin.js`, `frontend/src/admin/pages/PresetLibraryPage.jsx`: admin slot catalog and editor.
- `routes/shuihuo-production.js`, `frontend/src/user/pages/shuihuo/AssetsView.jsx`: selected prompt catalog and asset-analysis selection.
- `backend/internal/shuihuo/domain/types.go`, `backend/internal/shuihuo/store/assets.go`, `backend/internal/storage/migrations.go`: project prompt ID persistence.
- `tests/system-preset-catalog.test.js`, `tests/governance-routes.test.js`, `tests/shuihuo-gateway.test.js`, `tests/shuihuo-production-ui-contract.test.js`: Node and UI coverage.
- `backend/internal/shuihuo/store/assets_test.go`, `backend/internal/storage/migrations_test.go`, `backend/internal/httpapi/*_test.go`: Go coverage.

### Task 1: Register And Validate Ownership Slots

**Files:**
- Modify: `app.js`
- Modify: `lib/system-preset-catalog.js`
- Modify: `lib/preset-store.js`
- Test: `tests/system-preset-catalog.test.js`

- [ ] **Step 1: Write a failing slot resolver test**

Add a test for a published custom base preset with `protocolLock.slot: 'shuihuo.asset.character-extraction'`. Assert the published resolver returns only `{ id, name, version, slot }`; assert drafts with unknown slots, cross-module slots, or an add-on in a primary slot are rejected.

```js
assert.throws(() => store.createDraft('owner', {
  id: 'bad-slot', module: 'shuihuo-production', name: 'Bad', kind: 'base',
  description: '', compatibleBaseIds: [], body: 'x',
  protocolLock: { slot: 'novel.analysis' }
}), /Invalid preset draft/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/system-preset-catalog.test.js --test-name-pattern="slot"`

Expected: FAIL because the registry and validation do not exist.

- [ ] **Step 3: Implement the registry and validation**

Export `SYSTEM_PRESET_SLOTS`, `slotDefinition(slot)`, `slotsForModule(module)`, `validatePresetSlot(input)`, and `listPublishedForSlot(store, slot)` from `lib/system-preset-catalog.js`. Each registry entry must use `{ id, module, label, mode }`. Assign every built-in Script, Novel Panel, and Shuihuo preset one `protocolLock.slot`; map the existing two asset extractors to `shuihuo.asset.character-extraction` and `shuihuo.asset.scene-extraction`.

Make `createPresetStore` accept a slot validator and pass `validatePresetSlot` from `app.js`. New drafts must include a registry slot compatible with their module and kind. Continue reading legacy slotless records, but return `slot: null` in public summaries so admins can repair them. Update `seedSystemPresets` to publish one metadata-only newer version for each known built-in record missing its catalog slot, preserving its body, name, kind, and compatible IDs. Do not infer a custom legacy prompt's slot from its body or name.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/system-preset-catalog.test.js --test-name-pattern="slot"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js lib/system-preset-catalog.js lib/preset-store.js tests/system-preset-catalog.test.js
git commit -m "feat: define system preset ownership slots"
```

### Task 2: Manage Slots In The Admin Console

**Files:**
- Modify: `routes/admin.js`
- Modify: `frontend/src/shared/api/admin.js`
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Test: `tests/governance-routes.test.js`
- Test: `tests/system-preset-catalog.test.js`

- [ ] **Step 1: Write failing contracts**

Add route coverage for `GET /api/admin/preset-slots?module=shuihuo-production`, asserting authorized users receive IDs/labels only and unauthorized users receive `403`. Add frontend contracts for a required `归属` select, module-filtered options, and a `归属` table column that shows `待设置归属` for a legacy record.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/governance-routes.test.js tests/system-preset-catalog.test.js --test-name-pattern="slot|归属"`

Expected: FAIL because the endpoint and controls do not exist.

- [ ] **Step 3: Implement secure metadata flow**

Add:

```js
router.get('/preset-slots', (req, res) => {
  const module = req.query.module;
  if (!canManagePreset(req, module)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ slots: slotsForModule(module) });
});
```

Add `listAdminPresetSlots(module)` in `frontend/src/shared/api/admin.js`. In the editor, load slots on module change; submit `protocolLock: { ...parsedProtocolLock, slot: values.slot }`; add a table column resolving the slot label. Existing edits preselect their slot, while slotless legacy records cannot be republished without choosing one.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/governance-routes.test.js tests/system-preset-catalog.test.js --test-name-pattern="slot|归属"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/admin.js frontend/src/shared/api/admin.js frontend/src/admin/pages/PresetLibraryPage.jsx tests/governance-routes.test.js tests/system-preset-catalog.test.js
git commit -m "feat: manage system preset ownership slots"
```

### Task 3: Persist Project Asset Prompt IDs

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go`
- Modify: `backend/internal/shuihuo/store/assets.go`
- Modify: `backend/internal/shuihuo/store/assets_test.go`
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/storage/migrations_test.go`

- [ ] **Step 1: Write a failing persistence test**

Extend `TestAssetGenerationConfigIsProjectScoped` with `CharacterPresetID` and `ScenePresetID` values. Assert save/read preserves both only for the owning project and account.

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/shuihuo/store -run TestAssetGenerationConfigIsProjectScoped -count=1`

Expected: FAIL because the fields and SQL columns do not exist.

- [ ] **Step 3: Add fields, SQL, and a repeatable migration**

Add nullable strings:

```go
CharacterPresetID *string `json:"characterPresetId"`
ScenePresetID     *string `json:"scenePresetId"`
```

Add the next migration version with a custom idempotent apply that checks `information_schema.COLUMNS` before adding `character_preset_id VARCHAR(64) NULL` and `scene_preset_id VARCHAR(64) NULL` to `shuihuo_asset_generation_configs`. Update the store UPSERT, SELECT scan, and fake SQL driver argument indices. Preserve the old numeric `prompt_template_id` unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./internal/shuihuo/store ./internal/storage -run 'TestAssetGenerationConfigIsProjectScoped|Test.*Migration' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/shuihuo/domain/types.go backend/internal/shuihuo/store/assets.go backend/internal/shuihuo/store/assets_test.go backend/internal/storage/migrations.go backend/internal/storage/migrations_test.go
git commit -m "feat: persist Shuihuo asset prompt selections"
```

### Task 4: Resolve Selected Prompts At The Node Gateway

**Files:**
- Modify: `routes/shuihuo-production.js`
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go`
- Test: `tests/shuihuo-gateway.test.js`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: Write a failing selected-prompt test**

Create two published custom primary presets, one per asset slot. Send `/analysis/assets` their IDs plus forged browser prompt text. Assert the Go stub receives the selected IDs, current versions, and resolved bodies, never the forged text. Assert draft, archived, missing, and wrong-slot IDs return `409`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/shuihuo-gateway.test.js --test-name-pattern="selected asset prompts"`

Expected: FAIL because asset analysis resolves two fixed IDs.

- [ ] **Step 3: Implement resolution and guarded public catalog**

Add an authenticated `GET /api/shuihuo-production/preset-slots` response with published primary metadata for the two asset slots only. Resolve asset requests using selected IDs, defaulting only an unsaved project to the built-in IDs:

```js
const character = requirePublishedSlot(presetStore, characterId, 'shuihuo.asset.character-extraction');
const scene = requirePublishedSlot(presetStore, sceneId, 'shuihuo.asset.scene-extraction');
```

Replace all browser-supplied prompt text with both resolved bodies. Forward `characterPresetId`, `scenePresetId`, `systemPromptId`, and `systemPromptVersion`. Update the Go request structure to validate nonempty IDs/version before text-model invocation; it must not read Node preset storage.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/shuihuo-gateway.test.js --test-name-pattern="selected asset prompts|published system preset"
go test ./internal/httpapi -run 'Test.*Asset.*Prompt' -count=1
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/shuihuo-production.js backend/internal/httpapi/shuihuo_analysis_handlers.go tests/shuihuo-gateway.test.js backend/internal/httpapi/shuihuo_handlers_test.go
git commit -m "feat: resolve selected Shuihuo asset prompts"
```

### Task 5: Add Two Asset Prompt Selectors

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write a failing UI contract**

Assert `AssetsView` loads the slot catalog, renders `人物资产提示词` and `场景资产提示词`, sends `characterPresetId` and `scenePresetId` to `analyzeAssets`, and removes the single static `默认资产提示词` selection.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/shuihuo-production-ui-contract.test.js --test-name-pattern="资产提示词归属"`

Expected: FAIL because there is only a static one-option selector.

- [ ] **Step 3: Implement project selection UI**

Add `listShuihuoPresetSlots()` to the client API. Load models, generation config, and the catalog together; filter the two options by their slots. Save either selection through the existing project configuration endpoint. Submit:

```js
await analyzeAssets(data.project.id, {
  modelId,
  characterPresetId: generationConfig.characterPresetId,
  scenePresetId: generationConfig.scenePresetId
});
```

Use built-in IDs only when the saved field is null. If a saved ID is absent from its slot catalog, show an invalid-selection warning and disable `智能预设`; never silently switch to another prompt or show prompt bodies.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test tests/shuihuo-production-ui-contract.test.js
npm --prefix frontend run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/AssetsView.jsx tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: select asset prompts per Shuihuo project"
```

### Task 6: Full Verification

**Files:** no planned production edits. Any verified repair returns to the owning task and is committed with its task files.

- [ ] **Step 1: Run Node regressions**

Run: `node --test tests/system-preset-catalog.test.js tests/governance-routes.test.js tests/shuihuo-gateway.test.js tests/shuihuo-production-ui-contract.test.js`

Expected: zero failures.

- [ ] **Step 2: Run Go regressions**

Run: `go test ./internal/httpapi ./internal/shuihuo/store ./internal/storage`

Expected: zero failures.

- [ ] **Step 3: Run build and source checks**

Run: `npm --prefix frontend run build` and `git diff --check`.

Expected: both exit 0.

- [ ] **Step 4: Perform browser verification without calling a model**

Open `/shuihuo-production`, open `人物场景预设`, verify the two slot-filtered selectors, change a project selection, reload, and verify it persists. Do not click `智能预设`.

- [ ] **Step 5: Record verification evidence**

Record the exact command output, browser observations, and whether the external model call was deliberately skipped. Do not create a catch-all commit: a repair must be added to the relevant task's explicit file list and retested before that task's commit.
