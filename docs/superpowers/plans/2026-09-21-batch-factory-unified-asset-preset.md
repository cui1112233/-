# Batch Factory Unified Asset Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose one complete asset-preset selector for ordinary and H3 asset generation.

**Architecture:** The frontend persists only `assets.extraction` for newly selected asset schemes. An H3 scheme is a complete extraction preset whose server-side execution owns both H3 phases; legacy character and scene selections remain readable only. The preset library groups all new schemes under one asset-extraction section.

**Tech Stack:** React, Ant Design, Node source tests, Go batch-factory service.

## Global Constraints

- Preserve every pre-existing uncommitted file.
- New H3 behavior is selected only through the unified extraction selector.
- Legacy `batch.character-meta` and `batch.scene-meta` configurations remain readable.
- Use a failing test before each production behavior change.

---

### Task 1: Hide legacy per-kind selectors from the asset dialog

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Consumes `script.asset-extraction` catalog records.
- Produces one persisted `assets.extraction` selection.

- [ ] **Step 1: Write the failing test**

```js
test('asset dialog exposes one unified asset preset selector', () => {
  assert.match(source, /slot === 'script\.asset-extraction'/);
  assert.doesNotMatch(source, /slot === 'batch\.character-meta'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

- [ ] **Step 3: Implement the minimal catalog and save behavior**

Keep only `script.asset-extraction` entries in the dialog catalog. Always save a chosen item as `assets.extraction`; do not write `assets.character`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

### Task 2: Make H3 a complete extraction scheme

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `backend/internal/batchfactoryv11/director_contract.go`
- Modify: `backend/internal/batchfactoryv11/h3_batch_appearance.go`
- Test: `lib/system-preset-catalog.test.js`
- Test: `backend/internal/batchfactoryv11/h3_batch_appearance_test.go`

**Interfaces:**
- Consumes `assets.extraction.presetId`.
- Produces H3 fact extraction plus one all-character appearance compilation only for the H3 ID.

- [ ] **Step 1: Write failing catalog and backend tests**

```js
test('H3 full asset scheme is published in the extraction slot', () => {
  const preset = SYSTEM_PRESETS.find(item => item.id === 'batch-assets-h3');
  assert.equal(preset.protocolLock.slot, 'script.asset-extraction');
});
```

```go
func TestH3FullAssetSchemeUsesItsOwnTwoPhases(t *testing.T) {
    // Assert the selected extraction preset invokes H3 fact and appearance text,
    // not the legacy character/scene meta texts.
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/system-preset-catalog.test.js` and `go test ./internal/batchfactoryv11 -run TestH3FullAssetSchemeUsesItsOwnTwoPhases -count=1`

- [ ] **Step 3: Implement the minimal scheme mapping**

Publish `batch-assets-h3` in `script.asset-extraction`. Treat it as the source of both H3 phases. Keep old H3 character/scene IDs available only to resolve historical snapshots.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/system-preset-catalog.test.js` and `go test ./internal/batchfactoryv11 -run 'TestH3|TestAssetExtraction' -count=1`

### Task 3: Consolidate the AI reasoning and admin categories

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx`
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Test: `frontend/src/admin/pages/PresetLibraryPage.source.test.js`

**Interfaces:**
- Consumes catalog slot `script.asset-extraction`.
- Produces one “人物场景道具提示词” selection and one matching admin section.

- [ ] **Step 1: Write failing source tests**

```js
test('batch asset settings do not render per-kind prompt fields', () => {
  assert.doesNotMatch(source, /<Field label="人物提示词"/);
  assert.doesNotMatch(source, /<Field label="场景提示词"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/admin/pages/PresetLibraryPage.source.test.js`

- [ ] **Step 3: Implement minimal grouping**

Render one unified field and group `script-extract-assets` and `batch-assets-h3` under “人物场景道具提取”. Place legacy per-kind records in the existing compatibility section.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/admin/pages/PresetLibraryPage.source.test.js`

### Task 4: Regression and local browser verification

**Files:**
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx`
- Verify: `backend/internal/batchfactoryv11`

- [ ] **Step 1: Run focused suites**

Run: `node --test lib/system-preset-catalog.test.js lib/system-preset-h3-migration.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/admin/pages/PresetLibraryPage.source.test.js`

- [ ] **Step 2: Run backend suite**

Run: `cd backend && go test ./internal/batchfactoryv11 -count=1`

- [ ] **Step 3: Inspect local UI**

Open a book asset dialog and AI reasoning asset tab. Confirm there is one asset selector and H3 is selectable. Open admin preset library and confirm both full schemes are in the unified section.

- [ ] **Step 4: Commit only task-owned source and tests**

```bash
git add lib/system-preset-catalog.js lib/system-preset-catalog.test.js \
  frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx \
  frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js \
  frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx \
  frontend/src/admin/pages/PresetLibraryPage.jsx \
  frontend/src/admin/pages/PresetLibraryPage.source.test.js \
  backend/internal/batchfactoryv11/director_contract.go \
  backend/internal/batchfactoryv11/h3_batch_appearance.go \
  backend/internal/batchfactoryv11/h3_batch_appearance_test.go
git commit -m "fix(batch-factory): unify asset preset selection"
```
