# Batch Factory Unified Settings Version Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real version-pinned Batch Factory production settings system with backend sync, book/video inheritance overrides, and inline constraint editing.

**Architecture:** Reuse the existing preset store as the source of truth. A small config-version module builds deterministic snapshots from `batch-factory` preset history and resolves pinned preset bodies. Batch settings persist the selected snapshot; book and video overrides remain sparse maps layered at compile time. The existing Preview page consumes the catalog and real override APIs.

**Tech Stack:** Node.js 20+ CommonJS backend, `node:test`, Express, React 18, Ant Design 5, Vite.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-unified-settings-version-sync.md`

## Global Constraints

- Inheritance order is exactly `system < batch < book < video`.
- Backend sync must never delete book/video overrides.
- Model binding and max-duration capability remain server validated.
- Prompt constraints are dynamically compiled; do not bake them into `visualPrompt`.
- Work only on branch `08-batch-factory-unified-settings-version-sync`.

---

### Task 1: Version snapshots and pinned preset resolution

**Files:**
- Create: `lib/batch-factory/config-version.js`
- Modify: `lib/batch-factory/prompt-selection.js`
- Modify: `routes/batch-factory.js`
- Test: `test/batch-factory.test.js`

**Interfaces:**
- Produces `listBatchFactoryConfigVersions(presetStore)` returning `{ latest, versions }`.
- Produces `resolveVersionedPreset(presetStore, id, version)` and `resolveVersionedSystemPresetBody(presetStore, id, settings)`.
- `GET /api/batch-factory/prompt-catalog` returns prompt choices plus `configVersions` and `latestConfig`.

- [ ] **Step 1: Write failing tests** for deterministic history snapshots, latest snapshot dedupe, and exact historical body resolution.
- [ ] **Step 2: Run `npm test -- --test-name-pattern="配置版本|历史 preset"`** and verify failure because `config-version` does not exist.
- [ ] **Step 3: Implement `config-version.js`** using `presetStore.listAll('batch-factory')`, publication timestamps, deterministic SHA-256 revision truncation, and `getVersion` fallback.
- [ ] **Step 4: Wire prompt catalog and director/hook/prefix resolution** so pinned versions are used when a batch snapshot exists.
- [ ] **Step 5: Run focused tests and commit.**

### Task 2: Persist the full unified settings contract

**Files:**
- Modify: `lib/batch-factory/store.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `lib/batch-factory/effective-settings.js`
- Modify: `lib/batch-factory/video-prompt-compiler.js`
- Test: `test/batch-factory.test.js`

**Interfaces:**
- Batch settings add `systemConfigRevision`, `systemConfigLabel`, `systemConfigSyncedAt`, `systemPresetVersions`, prompt preset IDs+versions, injection toggles, quality/restriction/negative toggles, and subtitle policy.
- `resolveItemSettings(batch,item)` preserves false/empty overrides correctly.
- `resolveVideoSettings(batch,item,videoId)` applies video override last.

- [ ] **Step 1: Add failing tests** showing current normalization drops version/toggle fields and proving book/video precedence.
- [ ] **Step 2: Run focused tests and verify failures.**
- [ ] **Step 3: Extend safe normalizers** with bounded strings, booleans, positive versions, and sanitized preset-version maps.
- [ ] **Step 4: Extend effective settings and compiler** so enabled flags actually control section injection.
- [ ] **Step 5: Run tests and commit.**

### Task 3: Real book and VIDEO override persistence

**Files:**
- Modify: `routes/batch-factory-controls.js`
- Modify: `routes/batch-factory.js`
- Modify: `routes/batch-factory-production.js`
- Modify: `frontend/src/shared/api/batchFactory.js`
- Test: `test/batch-factory.test.js`

**Interfaces:**
- Existing `PUT /batches/:batchId/items/:itemId/overrides` accepts sparse book overrides and deletion via `inheritKeys`.
- New `PUT /batches/:batchId/items/:itemId/videos/:videoId/overrides` stores sparse video overrides and supports `inheritKeys`.
- Compile and production paths call `resolveVideoSettings`.

- [ ] **Step 1: Write failing unit tests** for sparse override normalization, restore-inheritance deletion, and video-over-book precedence.
- [ ] **Step 2: Run focused tests and verify failures.**
- [ ] **Step 3: Implement route helpers and video override endpoint.**
- [ ] **Step 4: Switch compile/production to resolved VIDEO settings and add frontend API helper.**
- [ ] **Step 5: Run tests and commit.**

### Task 4: Unified settings version selector and backend sync UI

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`

**Interfaces:**
- `ProductionSettingsModal` loads `getBatchFactoryPromptCatalog()` when opened.
- Version select stores the chosen snapshot fields in local settings.
- Sync button selects `latestConfig` only after a confirmation modal; saving uses existing `updateBatchFactorySettings`.

- [ ] **Step 1: Refactor modal state to use backend field names** and load the version catalog.
- [ ] **Step 2: Add version card** showing current revision, latest revision, selected snapshot, and sync action.
- [ ] **Step 3: Replace nested constraint forms with inline switch rows and lightweight edit popovers.**
- [ ] **Step 4: Add fixed-single-VIDEO and prompt preset controls without changing model binding.**
- [ ] **Step 5: Build frontend and commit.**

### Task 5: Current-book inheritance UI and VIDEO override UI

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPreviewPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-preview.css`

**Interfaces:**
- `CurrentBook` opens a real book settings modal and shows inherit/override badges per field.
- `VideoOverrideModal` maps to real persisted fields and calls the new video override API.
- Restore inheritance removes keys through `inheritKeys`.

- [ ] **Step 1: Enable current-book settings and bind the existing item override API.**
- [ ] **Step 2: Show inherited vs overridden state and restore buttons.**
- [ ] **Step 3: Persist VIDEO override edits instead of showing a fake success message.**
- [ ] **Step 4: Refresh the active batch after every override mutation.**
- [ ] **Step 5: Build frontend and commit.**

### Task 6: Verification and regression check

**Files:**
- No new production files unless verification exposes a bug.

- [ ] **Step 1: Run `npm test`.** Expected: all Node tests pass.
- [ ] **Step 2: Run `npm --prefix frontend run build`.** Expected: Vite build succeeds with zero compile errors.
- [ ] **Step 3: Compare branch against `master` and inspect changed files for accidental unrelated edits.**
- [ ] **Step 4: Check GitHub Actions for the branch commit if workflows run on branch pushes.**
- [ ] **Step 5: Report branch, commits, tests, remaining limitations, and do not merge without an explicit user request.**
