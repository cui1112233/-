# Batch Factory Single-Book Regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each novel row’s single-book configuration card into five actionable regions that independently inherit or override the batch configuration.

**Architecture:** Preserve the existing book-scoped settings API and optimistic revision writes. Make `aiPromptConfig` merge by module on the server so a book’s assets, constraints, video, and visual settings can be stored independently; the React card derives its five status labels from raw book overrides and opens the relevant centered configuration surface.

**Tech Stack:** React, Ant Design, Vite, Node source tests, Go batchfactoryv11 settings store and Go tests.

## Global Constraints

- The visible row order remains: 序号、小说正文、单书配置、预设、提示词、片段库、操作。
- Region clicks apply only to the selected `batchId + bookId`; no region may alter another book or the batch-wide configuration.
- Prompt choices use only published, slot-matched Personal Center presets and never expose preset bodies to the browser.
- Effective precedence remains batch → book → video; clearing a book region restores that region’s batch inheritance.
- Asset settings manage the selected book’s real assets and images; no placeholder generated image may be presented as a real asset.
- Existing legacy `aiPromptConfig` book payloads keep their effective behavior after the change.

---

### Task 1: Deep-merge AI prompt modules in effective book settings

**Files:**
- Modify: `backend/internal/batchfactoryv11/settings.go`
- Modify: `backend/internal/batchfactoryv11/settings_test.go`

**Interfaces:**
- Consumes: `SettingsPatch`, where `aiPromptConfig` is a JSON object with optional `assets`, `constraints`, `video`, and `visual` members.
- Produces: `ResolveSettings(layers ...SettingsPatch) SettingsPatch` whose final `aiPromptConfig` preserves batch modules that the book did not override.

- [ ] **Step 1: Write failing Go tests for module-level inheritance**

```go
func TestResolveSettingsDeepMergesAIPromptConfigModules(t *testing.T) {
    batch := SettingsPatch{"aiPromptConfig": raw(map[string]any{
        "assets": map[string]any{"enabled": true},
        "visual": map[string]any{"enabled": false},
    })}
    book := SettingsPatch{"aiPromptConfig": raw(map[string]any{
        "constraints": map[string]any{"enabled": true},
    })}

    got := ResolveSettings(batch, book)
    var prompt map[string]json.RawMessage
    if err := json.Unmarshal(got["aiPromptConfig"], &prompt); err != nil { t.Fatal(err) }
    for _, key := range []string{"assets", "constraints", "visual"} {
        if _, ok := prompt[key]; !ok { t.Fatalf("missing %s in %#v", key, prompt) }
    }
}

func TestResolveSettingsKeepsLegacyFullBookPromptPayload(t *testing.T) {
    batch := SettingsPatch{"aiPromptConfig": raw(map[string]any{"video": map[string]any{"presetId": "batch"}})}
    book := SettingsPatch{"aiPromptConfig": raw(map[string]any{"video": map[string]any{"presetId": "book"}})}
    got := ResolveSettings(batch, book)
    if !strings.Contains(string(got["aiPromptConfig"]), "book") { t.Fatal("book video override was lost") }
}
```

- [ ] **Step 2: Run the focused test before implementation**

Run: `go test ./internal/batchfactoryv11 -run 'TestResolveSettings(DeepMergesAIPromptConfigModules|KeepsLegacyFullBookPromptPayload)$' -count=1`

Expected: the deep-merge test fails because the current last-write-wins implementation removes `assets` and `visual`.

- [ ] **Step 3: Add explicit prompt-module merging in `ResolveSettings`**

```go
func mergePromptConfig(base, next json.RawMessage) json.RawMessage {
    merged := map[string]json.RawMessage{}
    _ = json.Unmarshal(base, &merged)
    var patch map[string]json.RawMessage
    if err := json.Unmarshal(next, &patch); err != nil { return append([]byte(nil), next...) }
    for key, value := range patch { merged[key] = value }
    out, err := json.Marshal(merged)
    if err != nil { return append([]byte(nil), next...) }
    return out
}
```

In `ResolveSettings`, treat `aiPromptConfig` as the sole deep-merged key: merge it with the prior resolved value, while retaining the current last-write-wins behavior for every other key.

- [ ] **Step 4: Run focused and package tests**

Run: `go test ./internal/batchfactoryv11 -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the independent backend behavior**

```bash
git add backend/internal/batchfactoryv11/settings.go backend/internal/batchfactoryv11/settings_test.go
git commit -m "feat: merge book AI prompt regions independently"
```

### Task 2: Save a single book’s engine and AI regions independently

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

**Interfaces:**
- Consumes: `BatchFactoryBookSettingsModal({ open, batch, book, activeRegion, onClose, onSaved, onOpenBookAssets })`, where `activeRegion` is one of `engine`, `assets`, `constraints`, `video`, or `visual`.
- Produces: `buildBookRegionUpdate(inherited, bookPatch, region, edited)` returning `{ patch, restoreKeys }` suitable for `saveBookOverride`.

- [ ] **Step 1: Add failing source tests for regional input and sparse writes**

```js
assert.match(source, /activeRegion/);
assert.match(source, /buildBookRegionUpdate/);
assert.match(source, /'engine', 'assets', 'constraints', 'video', 'visual'/);
assert.match(source, /restoreKeys/);
```

Add a fixture-level assertion that saving `constraints` does not put `assets`, `video`, or `visual` into a newly created book `aiPromptConfig` patch.

- [ ] **Step 2: Run the source test before implementation**

Run: `node --test src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: FAIL because the modal currently has no `activeRegion` input or region-level update builder.

- [ ] **Step 3: Make the save builder region-aware**

Implement the following behavior:

```js
const AI_REGION_KEYS = new Map([
  ['assets', 'assets'],
  ['constraints', 'constraints'],
  ['video', 'video'],
  ['visual', 'visual']
]);
```

- For `engine`, compare only `textModelId`, `imageModelId`, `videoModelId`, `videoProvider`, `aspectRatio`, `productionMode`, `maxVideoDuration`, `fixedSingleVideo`, and `fixedVideoDuration`; equal fields enter `restoreKeys` only when the book already had that raw field.
- For each AI region, compare only that module to the effective batch module. Save an `aiPromptConfig` object containing only changed modules, preserving existing raw book modules. If the region is restored and no AI modules remain, add `aiPromptConfig` to `restoreKeys`.
- Keep legacy raw book `aiPromptConfig` modules intact unless the user explicitly restores that same region.
- Render only the requested region in the centered modal, with its own `保存当前书覆盖` footer. An absent `activeRegion` opens `engine` for compatibility.

- [ ] **Step 4: Keep each region’s existing functional control**

- `engine`: model selectors, duration, fixed video, and aspect ratio.
- `assets`: extraction/character/scene/prop published-preset selectors and a `维护当前书人物场景预设` action that calls `onOpenBookAssets(book)`.
- `constraints`: the five script-generation constraint layers.
- `video`: video-prompt selector and fixed single/multiple VIDEO setting.
- `visual`: visual-prompt selector, off by default, separate from the video prompt.

Keep loading/error behavior from the existing modal, scoped to the controls visible in the active region.

- [ ] **Step 5: Run source tests**

Run: `node --test src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the book-region configuration surface**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
git commit -m "feat: save batch book settings by region"
```

### Task 3: Replace the generic card with five actionable region buttons

**Files:**
- Create: `frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Produces `BOOK_CONFIG_REGIONS` in this fixed order: `engine`, `assets`, `constraints`, `video`, `visual`.
- Produces `bookConfigRegionStatus(batch, book, region)` with `{ label, tone }`, where label is one of `继承作品配置`, `已单书覆盖`, or `未启用`.
- Consumes `onOpenRegion(book, region)` from the row renderer.

- [ ] **Step 1: Write failing source tests for the visible card contract**

```js
assert.match(source, /BOOK_CONFIG_REGIONS/);
assert.match(source, /引擎配置/);
assert.match(source, /资产设置/);
assert.match(source, /约束设置/);
assert.match(source, /视频设置/);
assert.match(source, /画面设置/);
assert.match(source, /setConfigTarget\(\{ book, region \}\)/);
assert.doesNotMatch(actions, /单书配置/);
```

- [ ] **Step 2: Run the source test before implementation**

Run: `node --test src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: FAIL because the current card has only one generic click target.

- [ ] **Step 3: Implement the region status helper**

```js
export const BOOK_CONFIG_REGIONS = [
  { key: 'engine', label: '引擎配置' },
  { key: 'assets', label: '资产设置' },
  { key: 'constraints', label: '约束设置' },
  { key: 'video', label: '视频设置' },
  { key: 'visual', label: '画面设置' }
];
```

Use raw `book.settingsState.patch` to determine an override. For AI regions use the raw module presence under `book.settingsState.patch.aiPromptConfig`; for a module with `enabled: false`, return `未启用`; otherwise return `已单书覆盖`. For assets, append the real saved character/scene/prop count to the card’s secondary text without calling generated assets “ready”.

- [ ] **Step 4: Render and route the five buttons**

Replace the generic `setConfigBook(book)` card with five compact buttons inside the existing `单书配置` cell. Store `{ book, region }` in one `configTarget` state object, pass `configTarget.region` and `onOpenBookAssets={setAssetBook}` into `BatchFactoryBookSettingsModal`, and clear the target on close. The asset region therefore contains both the book-scoped asset prompt selections and a direct action into the existing dedicated 人物场景预设 modal, which keeps the real Prompt/image editor in one durable surface.

- [ ] **Step 5: Apply the workbench styling**

Make the five buttons vertically stacked with visible labels and status text, keyboard focus outlines, and no horizontal overflow beyond the table’s existing scroll behavior. Keep the row height aligned with the larger `预设` / `提示词` / `片段库` cells.

- [ ] **Step 6: Run focused tests**

Run: `node --test src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the row interaction**

```bash
git add frontend/src/user/pages/shuihuo/batchFactoryBookConfigRegions.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo-production.css frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "feat: add batch book configuration regions"
```

### Task 4: Verify persistence, visual behavior, and build output

**Files:**
- Modify: `docs/批量工厂V11-新版布局与生产逻辑-完整.md`
- Test: `backend/internal/batchfactoryv11/settings_test.go`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- No new public endpoint or database migration. Existing `PUT /api/batch-factory/v11/batches/:batchId/books/:bookId/settings` remains the write interface.

- [ ] **Step 1: Update the V11 design document’s single-book section**

Record that the row card exposes five region buttons, raw module-level `aiPromptConfig` overrides deep-merge with the batch configuration, and the pre-existing `预设` cell remains the real-asset maintenance surface.

- [ ] **Step 2: Run backend regression tests**

Run: `go test ./internal/batchfactoryv11 -count=1`

Expected: PASS, including effective settings and readback tests.

- [ ] **Step 3: Run frontend regression tests and build**

Run:

```bash
node --test src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
npm run build
```

Expected: all source tests pass and Vite completes. The existing unresolved brand-logo warnings and chunk-size warning may appear, but no new error is acceptable.

- [ ] **Step 4: Perform authenticated browser acceptance**

At `http://127.0.0.1:5173/shuihuo-production`, verify on one imported batch:

1. The single-book cell shows five distinct buttons between 小说正文 and 预设.
2. Each button opens its matching centered configuration region for that exact book.
3. In 资产设置, use `维护当前书人物场景预设` and confirm the real Prompt/image editor contains only the selected book’s assets.
4. Save a constraints override for book 1; book 2 still reports inheritance.
5. Reopen book 1 to confirm readback, then restore the same constraint region and confirm the status returns to inheritance.
6. Confirm the `预设` cell still opens the same actual book-asset editor.

- [ ] **Step 5: Commit docs and verification-facing tests**

```bash
git add docs/批量工厂V11-新版布局与生产逻辑-完整.md backend/internal/batchfactoryv11/settings_test.go frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
git commit -m "docs: record batch book configuration regions"
```
