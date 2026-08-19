# Shuihuo Asset Preset Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shuihuo project assets analyzable by category, automatically bind them to subtitles, and generate persistent asset reference images with selectable style and character-sheet presets.

**Architecture:** Node resolves published system-preset slots and forwards only safe resolved prompt snapshots to Go. Go owns project-scoped styles, assets, asset images, binding results, and asset generation tasks; the existing provider adapter and object storage save real output. React renders the supplied workbench workflow and only submits selected category-scoped items.

**Tech Stack:** Express, React/Ant Design, Go/Chi, MySQL migrations, existing generic image-model adapter, Node test runner, Go test, Vite.

---

### Task 1: Add preset slots and routing

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `routes/shuihuo-production.js`
- Test: `tests/system-preset-catalog.test.js`, `tests/shuihuo-gateway.test.js`

- [ ] Write failing tests for `shuihuo-extract-props`, `shuihuo-asset-binding`, five character-sheet IDs, and rejection of browser-supplied prompt text.
- [ ] Run `node --test tests/system-preset-catalog.test.js tests/shuihuo-gateway.test.js` and confirm the new assertions fail.
- [ ] Seed all slots with stable IDs; add a `scope` resolver for character, scene, prop, and all analysis plus an asset-binding resolver. Node replaces request prompt bodies with selected published slot bodies.
- [ ] Re-run the targeted Node tests and confirm success.

### Task 2: Persist styles, asset images, and selections

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/shuihuo/domain/types.go`
- Create: `backend/internal/shuihuo/store/asset_styles.go`
- Create: `backend/internal/shuihuo/store/asset_images.go`
- Modify: `backend/internal/shuihuo/store/assets.go`
- Test: `backend/internal/shuihuo/store/asset_styles_test.go`, `backend/internal/shuihuo/store/asset_images_test.go`

- [ ] Write failing store tests for project/account isolation, style reference-media ownership, primary asset image switching, and immutable generated-image records.
- [ ] Run `go test ./internal/shuihuo/store -run 'TestAssetStyle|TestAssetImage'` and confirm failure.
- [ ] Add repeatable migrations for `shuihuo_asset_styles` and `shuihuo_asset_images`; add `style_id` and `character_sheet_preset_id` to project generation config.
- [ ] Implement stores with account/project ownership and active-task edit guards.
- [ ] Re-run targeted store tests and confirm success.

### Task 3: Add analysis, binding, and asset-generation backend APIs

**Files:**
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_analysis_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_asset_generation_handlers.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] Write failing handler tests for category scope, foreign-asset rejection, manual-binding preservation, task snapshots, and generated asset output not creating segment media.
- [ ] Run `go test ./internal/httpapi ./internal/shuihuo/tasks -run 'TestShuihuoAsset|TestAssetGeneration'` and confirm failure.
- [ ] Implement scoped analysis, automatic binding, asset-image batch creation, list, primary, and delete endpoints.
- [ ] Use bounded subtitle chunks for automatic binding. Preserve manually edited bindings; return assets plus binding retry information on partial failure.
- [ ] Extend the worker to persist generated output as an asset image, never `shuihuo_media`.
- [ ] Run `go test ./...` and confirm success.

### Task 4: Expose safe client contracts

**Files:**
- Modify: `routes/shuihuo-production.js`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Test: `tests/shuihuo-gateway.test.js`, `tests/shuihuo-production-ui-contract.test.js`

- [ ] Write failing API contract assertions for scoped analysis, auto binding, asset styles, asset-image tasks, and asset-image library endpoints.
- [ ] Run the targeted Node tests and confirm failure.
- [ ] Add authenticated gateway mapping and frontend API functions. Character-sheet resolution applies only to character generation; image reference data is omitted for an incompatible model.
- [ ] Re-run targeted Node tests and confirm success.

### Task 5: Implement the asset workbench UI

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Create: `frontend/src/user/pages/shuihuo/AssetScopeModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/StyleLibraryModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/AssetImageGrid.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] Write failing UI assertions for `全部预设`, `只解析角色`, `只解析场景`, `只解析道具`, `选择风格`, `人物设定`, `AI生成`, category filtering, and manual binding feedback.
- [ ] Run `node --test tests/shuihuo-production-ui-contract.test.js` and confirm failure.
- [ ] Implement a scope-and-candidate modal, editable project style library with reference upload, category-filtered selected-asset generation, and real generated-image grids.
- [ ] Keep the supplied desktop two-pane overlay. Stack controls and panes at narrow sizes without horizontal clipping.
- [ ] Re-run the UI contract test and `npm --prefix frontend run build`.

### Task 6: Verify without model spend

**Files:**
- Modify only tests from Tasks 1-5 when a real missing contract is found.

- [ ] Run Node gateway, UI contract, reference alignment, and system catalog tests.
- [ ] Run `go test ./...`, `npm --prefix frontend run build`, and `git diff --check`.
- [ ] Reload `/shuihuo-production`, inspect the asset overlay, scope selector, candidate list, style form, character-only sheet selector, library tabs, and refreshed row bindings. Do not submit a paid image-generation task without explicit user confirmation.
