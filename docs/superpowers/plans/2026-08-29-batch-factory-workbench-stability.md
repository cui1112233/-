# Batch Factory Workbench Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Batch Factory to the confirmed product design: theme-safe, batch-first, exception-first, progressively disclosed, card-based editable workspace with one unified media player, correct status filtering, stable inheritance, real runtime account state, and green CI.

**Architecture:** Keep business rules in the existing batch-factory backend/store/compiler modules, but split the oversized frontend page into focused workspace units. The workbench becomes a 12-column snap-to-grid card layout that is locked during normal production and editable only in an explicit layout mode. Ant Design owns component theming through `defaultAlgorithm` / `darkAlgorithm`; Batch Factory-specific CSS is limited to layout and non-AntD chrome. Existing production/status components are reused rather than duplicated, and runtime-only Video Management System authentication stays outside version/config snapshots.

**Tech Stack:** Node.js 22 `node --test`, Express 5, React 18, Ant Design 5, Vite 5, existing qiantie production bridge APIs. No new third-party layout dependency.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-workbench-stability-design.md`

## Global Constraints

- Product rules come from `00-AI必读-批量工厂产品记忆.md`, `01-批量工厂需求决策表.md`, and the latest user decisions in this conversation.
- The supplied Batch Factory screenshot is a visual-density/default-layout reference only; it does not override product rules.
- Batch-first, exception-first, progressive disclosure remain the primary UX rules.
- Main production UI must not restore Prompt Studio or expose raw system meta-prompts.
- `visualPrompt` and `compiledPrompt` remain separate; generation-time injections never overwrite `visualPrompt`.
- Inheritance remains `system default < batch < book < VIDEO`; untouched lower layers continue inheriting upper-layer changes.
- One workbench media player only. VIDEO rows/cards must not embed their own independent players.
- Batch status center is only a filter entry; filtered books render in the adjacent `当前筛选` region, never below the status-center chips.
- Workspace layout is grid-snapped, editable only in explicit layout-edit mode, persisted locally, and normal production mode is locked.
- `固定单 VIDEO` controls VIDEO count only. VIDEO duration is controlled independently by duration strategy and model capability.
- `跟随音频时长` remains a real merge strategy from the confirmed product design: TTS is measurement-only; its audio is never merged into the final MP4.
- Video Management System runtime account name/login state/cookies/credentials never enter publish version configuration.
- Publish version configuration remains publish-only (`materialReuse`, `horizontalFlip`, snapshot metadata).
- If the real Video Management System adapter cannot be resolved from the existing Novel Fetch flow, the UI must report `unavailable`; never fake online state or invent a login URL.
- Do not implement a fake publish upload. Until the real publish API exists, show capability state rather than a permanently-disabled primary CTA pretending to be usable.
- No new Split Pane / draggable-grid package in this change.
- Final verification requires both `npm test` and `npm run frontend:build` green in PR CI.

---

## File Structure

### New focused frontend units

- `frontend/src/user/pages/batch-factory/workspace-layout.js`
  - Pure layout schema/default/normalize/move/resize helpers.
  - No React or DOM dependency so Node tests can dynamically import it.
- `frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx`
  - Grid workspace, edit-mode controls, drag/resize pointer handling, hidden/maximized cards.
- `frontend/src/user/pages/batch-factory/BatchFactoryStatusCenter.jsx`
  - Status counts, one-primary-status resolver, adjacent filtered-book list.
- `frontend/src/user/pages/batch-factory/BatchFactoryUnifiedPreview.jsx`
  - The only `<video>` player in Batch Factory; switches between merged output and VIDEO media.
- `frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx`
  - Thin card-content composition for book list, current-book workbench, preview/merge, and batch tools.
- `frontend/src/shared/styles/batch-factory.css`
  - Batch Factory layout/edit-mode/grid styles only; no broad AntD semantic-color overrides.

### Existing frontend files to modify

- `frontend/src/user/pages/BatchFactoryPageV9.jsx`
  - Becomes state/orchestration shell; removes fixed `styles.columns`, duplicate player, and duplicate merge UI.
- `frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx`
  - Duration strategy, model compatibility guard, legacy constraint-enabled fallback, publish/account-state refinements.
- `frontend/src/user/pages/batch-factory/BatchConstraintSettings.jsx`
  - Fix undefined legacy enabled flags and system-preset editing mode behavior.
- `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`
  - Reuse bound-model capability semantics; display fixed-duration context without changing bound model silently.
- `frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx`
  - Feed batch tools card; no duplicate status dashboard.
- `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
  - Reuse polling/retry/merge functions, remove embedded `VideoResultPreview`, enable real TTS measurement strategy, export status helpers used by status center.
- `frontend/src/shared/styles/theme.js`
  - Use AntD algorithms.
- `frontend/src/shared/styles/global.css`
  - Remove high-risk AntD color overrides; keep shell/brand styles.
- `frontend/src/user/main.jsx`
  - Import `batch-factory.css`.

### Existing backend files to modify only where business semantics require it

- `lib/batch-factory/store.js`
  - Persist `videoDurationMode`, `fixedVideoDuration`, and legacy constraint-enable fallback consistently.
- `lib/batch-factory/effective-settings.js`
  - Preserve field-level inheritance for new duration fields.
- `lib/batch-factory/director-output.js`
  - Apply fixed-duration/fixed-single-VIDEO semantics at director normalization boundary; do not mutate only a number after the fact.
- `lib/batch-factory/video-prompt-compiler.js`
  - Consume normalized per-VIDEO duration and effective settings; retain prompt separation.
- `routes/batch-factory-controls.js`
  - Validate/save new production duration fields and publish/account state behavior.
- `routes/batch-factory-production.js`
  - Keep bound-model enforcement and compiled-prompt snapshot behavior; add incompatibility guard where necessary.
- `lib/batch-factory/video-management-account.js`
  - Keep `online | login_required | unavailable` normalization.
- `app.js`, `server.js`
  - Wire the real existing account adapter into runtime startup if the Novel Fetch implementation exposes one.

### Tests

- Modify: `tests/batch-factory-constraints-ui-contract.test.js`
- Modify: `tests/batch-factory-effective-settings.test.js`
- Modify: `tests/batch-factory-video-prompt-compiler.test.js`
- Modify: `tests/batch-factory-video-management-account.test.js`
- Create: `tests/batch-factory-workspace-layout.test.js`
- Create: `tests/batch-factory-workbench-ui-contract.test.js`
- Create: `tests/batch-factory-status-model.test.js`
- Create: `tests/batch-factory-duration-strategy.test.js`
- Create: `tests/batch-factory-theme-contract.test.js`

---

### Task 1: Lock the corrected workbench contracts with RED tests

**Files:**
- Create: `tests/batch-factory-workbench-ui-contract.test.js`
- Create: `tests/batch-factory-theme-contract.test.js`
- Modify: `tests/batch-factory-constraints-ui-contract.test.js`

**Interfaces:**
- Consumes: current source files only.
- Produces: executable contracts that prevent regressions back to fixed columns, multiple players, silent API errors, and conflicting theme overrides.

- [ ] **Step 1: Add a source-contract test for the workbench structure**

Use `node:fs` to read the relevant files and assert the new structure explicitly:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend/src/user/pages/BatchFactoryPageV9.jsx'), 'utf8');
const workspacePath = path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx');

test('batch factory uses editable grid workspace instead of fixed columns', () => {
  assert.doesNotMatch(page, /gridTemplateColumns:\s*'minmax\(230px/);
  assert.match(page, /BatchFactoryWorkspace/);
  assert.equal(fs.existsSync(workspacePath), true);
});

test('batch factory has exactly one unified video player implementation', () => {
  const files = [
    'frontend/src/user/pages/BatchFactoryPageV9.jsx',
    'frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx',
    'frontend/src/user/pages/batch-factory/BatchFactoryUnifiedPreview.jsx'
  ].map(file => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '');
  const videoTags = files.join('\n').match(/<video\b/g) || [];
  assert.equal(videoTags.length, 1);
});
```

- [ ] **Step 2: Add theme-contract RED tests**

```js
const themeSource = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/theme.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/global.css'), 'utf8');

test('theme uses Ant Design light/dark algorithms', () => {
  assert.match(themeSource, /defaultAlgorithm/);
  assert.match(themeSource, /darkAlgorithm/);
});

test('global css does not force semantic AntD tag text color', () => {
  assert.doesNotMatch(css, /\.user-theme-active\s+\.ant-tag\s*\{[^}]*color:/s);
});
```

- [ ] **Step 3: Extend constraint UI contract for legacy enabled flags and visible load errors**

Require helpers or expressions that implement:

```text
boolean flag present -> use flag
flag undefined -> fallback to Boolean(existing body)
prefix undefined -> true
```

and reject `getBatchFactoryPromptCatalog().then(...).catch(() => {})` / `listModels().then(...).catch(() => {})` silent catches in `BatchFactorySettingsDrawers.jsx`.

- [ ] **Step 4: Run targeted tests and confirm RED for the intended reasons**

Run:

```bash
node --test tests/batch-factory-workbench-ui-contract.test.js tests/batch-factory-theme-contract.test.js tests/batch-factory-constraints-ui-contract.test.js
```

Expected: failures for missing workspace/unified-preview files, missing AntD algorithms, and current fixed-column/multiple-player/silent-catch code.

- [ ] **Step 5: Commit tests only**

```bash
git add tests/batch-factory-workbench-ui-contract.test.js tests/batch-factory-theme-contract.test.js tests/batch-factory-constraints-ui-contract.test.js
git commit -m "test(batch-factory): lock workbench and theme contracts"
```

---

### Task 2: Make Ant Design the single component-theme authority

**Files:**
- Modify: `frontend/src/shared/styles/theme.js`
- Modify: `frontend/src/shared/styles/global.css`
- Create: `frontend/src/shared/styles/batch-factory.css`
- Modify: `frontend/src/user/main.jsx`
- Test: `tests/batch-factory-theme-contract.test.js`

**Interfaces:**
- Produces: `createAntTheme(mode)` returning `{ algorithm, token }`.
- Batch Factory CSS uses `--bf-*` layout variables and `data-theme` only for custom surfaces, not AntD semantic components.

- [ ] **Step 1: Update `createAntTheme`**

Implement:

```js
import { theme as antdTheme } from 'antd';

export function createAntTheme(mode) {
  return {
    algorithm: mode === 'light' ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
    token: {
      ...common,
      ...(mode === 'light' ? light : dark)
    }
  };
}
```

Do not remove the existing brand color/typography/background tokens yet; algorithm + explicit tokens may coexist.

- [ ] **Step 2: Remove global semantic-color overrides that fight AntD**

Remove broad rules that force component colors such as:

```css
.user-theme-active .ant-tag { color: var(--legacy-text); ... }
.user-theme-active .ant-btn:disabled { background: ... }
```

Keep shell/legacy layout rules and only retain AntD overrides when they are structural and do not override semantic foreground/background pairing.

- [ ] **Step 3: Add `batch-factory.css`**

Start with layout-only classes:

```css
.batch-factory-page { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.batch-factory-scroll { min-height: 0; overflow: auto; }
.batch-factory-card-body { min-height: 0; overflow: auto; }
.batch-factory-media { background: #050505; border-radius: 10px; overflow: hidden; }
```

Use CSS variables or AntD token-fed inline styles for selected borders instead of hard-coded `#1677ff`.

- [ ] **Step 4: Import Batch Factory stylesheet**

In `frontend/src/user/main.jsx` add:

```js
import '../shared/styles/batch-factory.css';
```

- [ ] **Step 5: Run theme tests and frontend build**

```bash
node --test tests/batch-factory-theme-contract.test.js
npm run frontend:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shared/styles/theme.js frontend/src/shared/styles/global.css frontend/src/shared/styles/batch-factory.css frontend/src/user/main.jsx tests/batch-factory-theme-contract.test.js
git commit -m "fix(theme): unify light and dark Ant Design theming"
```

---

### Task 3: Build the snap-to-grid layout model first

**Files:**
- Create: `frontend/src/user/pages/batch-factory/workspace-layout.js`
- Create: `tests/batch-factory-workspace-layout.test.js`

**Interfaces:**
- Produces:
  - `WORKSPACE_STORAGE_KEY`
  - `DEFAULT_WORKSPACE_LAYOUT`
  - `normalizeWorkspaceLayout(raw, defaults)`
  - `moveWorkspaceItem(layout, id, nextX, nextY)`
  - `resizeWorkspaceItem(layout, id, nextW, nextH)`
  - `setWorkspaceItemHidden(layout, id, hidden)`
  - `mergeWorkspaceDefaults(saved, defaults)`
- Layout item shape: `{ x, y, w, h, minW, minH, hidden, collapsed }`.

- [ ] **Step 1: Write failing pure-layout tests using dynamic ESM import**

```js
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadLayoutModule() {
  return import(pathToFileURL(path.join(__dirname, '../frontend/src/user/pages/batch-factory/workspace-layout.js')).href);
}

test('invalid persisted values fall back and new cards are merged from defaults', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, mergeWorkspaceDefaults } = await loadLayoutModule();
  const saved = { items: { 'book-list': { x: -5, y: 0, w: 0, h: 1, hidden: false } } };
  const result = mergeWorkspaceDefaults(saved, DEFAULT_WORKSPACE_LAYOUT);
  assert.equal(result.items['book-list'].x >= 0, true);
  assert.equal(result.items.preview.w >= result.items.preview.minW, true);
  assert.ok(result.items['batch-tools']);
});
```

Also test that unknown saved card IDs are dropped and `hidden` survives normalization.

- [ ] **Step 2: Run test and confirm RED**

```bash
node --test tests/batch-factory-workspace-layout.test.js
```

Expected: module-not-found.

- [ ] **Step 3: Implement the default 12-column layout**

Use a default matching the confirmed visual hierarchy, not a fixed-pane contract:

```js
export const WORKSPACE_STORAGE_KEY = 'qiantie:batch-factory:layout:v1';
export const DEFAULT_WORKSPACE_LAYOUT = {
  columns: 12,
  rowHeight: 48,
  items: {
    'book-list': { x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 5, hidden: false, collapsed: false },
    'book-workbench': { x: 3, y: 0, w: 5, h: 10, minW: 4, minH: 6, hidden: false, collapsed: false },
    preview: { x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 4, hidden: false, collapsed: false },
    'batch-tools': { x: 8, y: 6, w: 4, h: 4, minW: 3, minH: 3, hidden: false, collapsed: false }
  }
};
```

Normalize all numeric values with finite/integer checks and clamp `x + w <= columns`.

- [ ] **Step 4: Implement pure move/resize/hide functions**

Functions return a new layout object; do not mutate input. Move/resize snap to integer grid units and clamp to card constraints.

- [ ] **Step 5: Run tests GREEN**

```bash
node --test tests/batch-factory-workspace-layout.test.js
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/user/pages/batch-factory/workspace-layout.js tests/batch-factory-workspace-layout.test.js
git commit -m "feat(batch-factory): add persisted grid layout model"
```

---

### Task 4: Implement explicit layout-edit mode and card workspace

**Files:**
- Create: `frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx`
- Modify: `frontend/src/shared/styles/batch-factory.css`
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Test: `tests/batch-factory-workbench-ui-contract.test.js`

**Interfaces:**
- `BatchFactoryWorkspace({ cards, storageKey = WORKSPACE_STORAGE_KEY })`
- Each card descriptor: `{ id, title, content, extra?, minW?, minH? }`.
- Normal mode: layout locked.
- Edit mode: draft layout only; Save persists, Cancel restores pre-edit layout, Restore Default requires confirmation.

- [ ] **Step 1: Write the UI contract for explicit edit mode**

Require the source to contain exact controls:

```text
编辑布局
保存布局
取消
恢复默认布局
显示模块
```

and reject always-on drag handles in normal mode.

- [ ] **Step 2: Build workspace state lifecycle**

On mount:

```js
const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
setLayout(mergeWorkspaceDefaults(saved, DEFAULT_WORKSPACE_LAYOUT));
```

On `编辑布局`:

```js
setBeforeEditLayout(layout);
setDraftLayout(layout);
setEditing(true);
```

Save writes only layout JSON. Cancel restores `beforeEditLayout`. Restore default sets draft to a clone of `DEFAULT_WORKSPACE_LAYOUT` after `Modal.confirm`.

- [ ] **Step 3: Implement drag with Pointer Events on the card header handle**

During edit mode only:

```js
handle.setPointerCapture(event.pointerId);
```

Convert pointer delta to grid-column/row delta from current workspace dimensions and `rowHeight`, then call `moveWorkspaceItem`. Do not drag when the pointer originates from interactive header actions.

- [ ] **Step 4: Implement bottom-right resize handle**

Resize only in edit mode; update width/height through `resizeWorkspaceItem`. Add `user-select: none` to the workspace while dragging/resizing.

- [ ] **Step 5: Add collapse/maximize/hide behavior**

- Collapse keeps the card in layout but shows only header height.
- Hide removes it from grid rendering and makes it available under `显示模块`.
- Maximize is transient UI state and is not required to overwrite the saved grid coordinates; closing maximize restores the saved position.

- [ ] **Step 6: Add responsive fallback**

Use container `ResizeObserver`:

```text
>= 1180px: saved 12-column desktop grid
900–1179px: automatic two-column flow; drag/resize disabled
< 900px: automatic one-column flow; drag/resize disabled
```

Responsive modes must not write over the stored desktop layout.

- [ ] **Step 7: Replace fixed `styles.columns` in `BatchFactoryPageV9.jsx` with workspace composition**

Do not redesign card content yet; initially wrap the current major regions as descriptors to make this task independently testable.

- [ ] **Step 8: Run targeted tests + build**

```bash
node --test tests/batch-factory-workspace-layout.test.js tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

Expected: PASS for layout contract; any remaining unified-player/status contract failures stay RED until their tasks.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx frontend/src/shared/styles/batch-factory.css frontend/src/user/pages/BatchFactoryPageV9.jsx tests/batch-factory-workbench-ui-contract.test.js
git commit -m "feat(batch-factory): add editable grid workbench"
```

---

### Task 5: Make status-center semantics authoritative and adjacent

**Files:**
- Create: `frontend/src/user/pages/batch-factory/BatchFactoryStatusCenter.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Create: `tests/batch-factory-status-model.test.js`
- Test: `tests/batch-factory-workbench-ui-contract.test.js`

**Interfaces:**
- Export from `BatchFactoryVideoProductionStatus.jsx` or a small pure helper module:
  - `resolveBatchFactoryBookStatus(item, projectStatus)`
  - `BATCH_FACTORY_BOOK_STATUS_META`
- `BatchFactoryStatusCenter({ batch, statusByProject, selectedFilter, onFilterChange, onSelectBook })`.

- [ ] **Step 1: Add RED tests for one-primary-status precedence**

Test examples:

```js
assert.equal(resolve(itemWithFailedVideo), 'failed');
assert.equal(resolve(itemWithManualOverrideAndFailedVideo), 'failed');
assert.equal(resolve(itemHookReview), 'review');
assert.equal(resolve(itemAllVideosSucceededNoMerge), 'ready_merge');
assert.equal(resolve(itemMerged), 'merged');
```

Also add status keys for `ready_upload`, `uploading`, `published` when publish data exists; `published` is the terminal published state, while UI copy may display `已完成` only after actual publish success.

- [ ] **Step 2: Export the existing status resolver instead of maintaining two versions**

Rename internal `resolveBookStatus` to `resolveBatchFactoryBookStatus` and export it. Update existing production-status components to call the exported function.

- [ ] **Step 3: Build `BatchFactoryStatusCenter`**

Render one wide card with two fixed regions:

```text
批次状态中心                     当前筛选
[全部] [待审核] ...              异常 · 4 本
                                  book rows...
```

Clicking a chip changes only the right list. It must not append a list below the chips.

- [ ] **Step 4: Wire filtered-book click**

`onSelectBook(itemId, statusKey)` updates selected book. If `statusKey === 'failed'`, also set a `focusIssue` state so the current-book card opens the relevant failed VIDEO/merge/publish section.

- [ ] **Step 5: Remove duplicate status mapping from `BatchFactoryPageV9.jsx`**

Delete local `itemStatus()` after all callers use the shared resolver/meta.

- [ ] **Step 6: Run tests/build**

```bash
node --test tests/batch-factory-status-model.test.js tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/user/pages/batch-factory/BatchFactoryStatusCenter.jsx frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx frontend/src/user/pages/BatchFactoryPageV9.jsx tests/batch-factory-status-model.test.js tests/batch-factory-workbench-ui-contract.test.js
git commit -m "feat(batch-factory): add adjacent batch status filtering"
```

---

### Task 6: Replace all embedded previews with one unified media player

**Files:**
- Create: `frontend/src/user/pages/batch-factory/BatchFactoryUnifiedPreview.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx` if created in this task
- Test: `tests/batch-factory-workbench-ui-contract.test.js`

**Interfaces:**
- `BatchFactoryUnifiedPreview({ item, projectStatus, selectedMediaKey, onSelectedMediaKeyChange })`
- media keys: `merged`, `video:<index>`.
- `resolveBatchFactoryVideoProduction(item, index, projectStatus)` remains the source of VIDEO media/task status.

- [ ] **Step 1: Add/activate the one-player RED contract**

The combined Batch Factory page/status/preview sources must contain exactly one `<video` tag and that tag must live in `BatchFactoryUnifiedPreview.jsx`.

- [ ] **Step 2: Move media loading lifecycle into `BatchFactoryUnifiedPreview`**

The component owns one object URL ref and revokes the previous URL whenever target media changes or component unmounts.

Target list order:

```text
最终合并
VIDEO 01
VIDEO 02
...
```

Disable entries without media instead of creating blank players.

- [ ] **Step 3: Define selection defaults**

On book switch:

1. If merged media exists, default to `merged`.
2. Otherwise select the newest playable VIDEO.
3. Otherwise show an Empty state.

- [ ] **Step 4: Remove `VideoResultPreview` and current page-level player**

`BatchFactoryVideoProductionStatus.jsx` VIDEO rows keep status, retry, download, prompt inspection, and a `预览` action callback only. They must not render `<video>`.

`BatchFactoryPageV9.jsx` deletes its `previewUrl`, `previewRef`, `loadPreview`, and `<video controls ...>` block.

- [ ] **Step 5: Wire VIDEO row click to unified preview selection**

Clicking `VIDEO 03` or `预览` sets `selectedMediaKey = 'video:2'`; the preview card loads it.

- [ ] **Step 6: Run contract/build**

```bash
node --test tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/user/pages/batch-factory/BatchFactoryUnifiedPreview.jsx frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx frontend/src/user/pages/BatchFactoryPageV9.jsx tests/batch-factory-workbench-ui-contract.test.js
git commit -m "refactor(batch-factory): use one unified media preview"
```

---

### Task 7: Compose the confirmed progressive-disclosure card contents

**Files:**
- Create: `frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx`
- Modify: `frontend/src/shared/styles/batch-factory.css`
- Test: `tests/batch-factory-workbench-ui-contract.test.js`

**Interfaces:**
- `createBatchFactoryWorkbenchCards(context) -> card descriptors[]` or equivalent focused components.
- Core cards: `book-list`, `book-workbench`, `preview`, `batch-tools`.

- [ ] **Step 1: Build `book-list` card**

Include search by title/BookID, optional status filter, item number/title/BookID/platform/primary status, purple manual-override badge, and red failure priority.

Do not use `72vh`; card body scrolls inside workspace sizing.

- [ ] **Step 2: Build current-book workbench with collapsed sections**

Order:

```text
当前需要处理 (only when abnormal)
原文
爆款开头 (viral only)
人物 / 场景 / 道具
VIDEO
合并
发布
操作记录
```

Normal sections are collapsed/summary-first. The abnormal section auto-expands the failing VIDEO/merge/publish child.

- [ ] **Step 3: Reuse existing components instead of copying their logic**

Use:

- `BatchConstraintSummary` / `BatchBookConstraintModal`
- `BatchFactoryProductionControls`
- useful retry/status functions from `BatchFactoryVideoProductionStatus`
- existing director regeneration/source save APIs

Do not introduce a second production polling loop.

- [ ] **Step 4: Build preview card**

Render `BatchFactoryUnifiedPreview` plus merge controls underneath or adjacent inside the same card, following the saved grid size.

- [ ] **Step 5: Build batch-tools card**

Reuse batch-level production status / bulk production / bulk merge operations from `BatchFactoryBulkProduction` and `BatchFactoryVideoProductionStatus`, but avoid nesting multiple full-width Cards inside the outer grid card. Refactor those components to support `embedded` presentation where needed.

- [ ] **Step 6: Replace deep Card-in-Card styling**

Use sections/dividers/collapse rows inside grid cards. Outer workspace card is the primary surface.

- [ ] **Step 7: Run contract/build**

```bash
node --test tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx frontend/src/user/pages/BatchFactoryPageV9.jsx frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx frontend/src/shared/styles/batch-factory.css tests/batch-factory-workbench-ui-contract.test.js
git commit -m "refactor(batch-factory): compose progressive workbench cards"
```

---

### Task 8: Correct production duration semantics and legacy constraint inheritance

**Files:**
- Modify: `frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchConstraintSettings.jsx`
- Modify: `lib/batch-factory/store.js`
- Modify: `lib/batch-factory/effective-settings.js`
- Modify: `lib/batch-factory/director-output.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `routes/batch-factory-production.js` only for compatibility validation if needed
- Modify: `tests/batch-factory-effective-settings.test.js`
- Create: `tests/batch-factory-duration-strategy.test.js`
- Modify: `tests/batch-factory-constraints-ui-contract.test.js`

**Interfaces:**
- Batch settings:

```js
{
  videoDurationMode: 'auto' | 'fixed',
  fixedVideoDuration: number | null,
  fixedSingleVideo: boolean
}
```

- `fixedSingleVideo` never implicitly sets duration to `maxVideoDuration`.

- [ ] **Step 1: Add backend RED tests**

Test:

```js
assert.equal(normalized.videoDurationMode, 'fixed');
assert.equal(normalized.fixedVideoDuration, 10);
assert.equal(normalized.fixedSingleVideo, true);
```

and ensure fixed duration greater than `maxVideoDuration` is rejected or normalized with an explicit validation error, never silently clipped.

Add effective-settings test proving book/video overrides do not erase untouched batch duration fields.

- [ ] **Step 2: Persist normalized duration settings in the store/control route**

Validation rules:

```text
auto -> fixedVideoDuration = null
fixed -> fixedVideoDuration integer >= 1 and <= maxVideoDuration
fixedSingleVideo -> boolean independent of duration mode
```

If the model advertises explicit duration choices, frontend uses those choices; otherwise offer integer choices bounded by `maxVideoDuration` rather than assuming every model supports only 10/15.

- [ ] **Step 3: Update `UnifiedSettings` UI**

Render:

```text
VIDEO 时长策略
[AI自动] [固定时长]

固定时长 -> [可用时长 ▼]

固定单 VIDEO [switch]
说明：只限制每本小说最终生成 1 个 VIDEO；该 VIDEO 仍按上方时长策略执行。
```

When switching model, if current fixed duration is unsupported, show a blocking confirmation/warning and require a valid duration before Save.

- [ ] **Step 4: Apply fixed-single semantics at director normalization boundary**

Do not simply edit `duration_sec` after a storyboard is generated. For new director output, when `fixedSingleVideo === true`, normalize to one VIDEO with the selected/derived duration and distribute its Shot timeline accordingly according to the current director output logic. Existing already-directed batches are not silently rewritten when settings are changed after lock.

- [ ] **Step 5: Fix legacy constraint enabled fallback**

Use one helper rule in both drawer and `BatchConstraintEditor`:

```js
function enabledOrLegacy(flag, body, defaultValue = false) {
  return typeof flag === 'boolean' ? flag : (body ? true : defaultValue);
}
```

Prefix passes `defaultValue = true`; quality/restriction/negative fall back to body presence.

- [ ] **Step 6: Fix system-preset editing mode**

Typing into a system-preset draft must not silently switch the source selector to `我的提示词`. Editing remains a draft of the currently selected source until user explicitly saves it as a personal prompt.

- [ ] **Step 7: Replace silent data-load catches**

Change prompt/model load failures to visible `message.error` or inline Alert and preserve the last known draft instead of emptying controls silently.

- [ ] **Step 8: Run duration/constraint/effective tests + build**

```bash
node --test tests/batch-factory-duration-strategy.test.js tests/batch-factory-effective-settings.test.js tests/batch-factory-constraints-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx frontend/src/user/pages/batch-factory/BatchConstraintSettings.jsx lib/batch-factory/store.js lib/batch-factory/effective-settings.js lib/batch-factory/director-output.js routes/batch-factory-controls.js routes/batch-factory-production.js tests/batch-factory-duration-strategy.test.js tests/batch-factory-effective-settings.test.js tests/batch-factory-constraints-ui-contract.test.js
git commit -m "fix(batch-factory): separate video count and duration semantics"
```

---

### Task 9: Consolidate merge logic and make TTS timing a real strategy

**Files:**
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx`
- Test: `tests/batch-factory-workbench-ui-contract.test.js`

**Interfaces:**
- Merge strategy UI: `fixed | audio`.
- TTS measurement uses existing `getConfig()` + `textToSpeech()` configuration.
- TTS output is temporary measurement audio only.
- Final merge payload stays video-only: `{ projectId, bookId, mediaIds, speed }`.

- [ ] **Step 1: Remove the duplicate legacy `MergePanel` from `BatchFactoryPageV9.jsx`**

Keep one merge implementation in `BatchFactoryVideoProductionStatus.jsx` / workbench card composition.

- [ ] **Step 2: Re-enable `跟随音频时长` as a real selectable strategy**

Replace the current disabled placeholder:

```js
{ value: 'audio', label: '跟随音频时长 · 即将支持', disabled: true }
```

with:

```js
{ value: 'audio', label: '跟随音频时长' }
```

- [ ] **Step 3: Move the already-working measurement logic into the consolidated merge component**

Use current story text:

```js
const narration = batch.mode === 'viral'
  ? (item.approvedHookScript || item.sourceText)
  : item.sourceText;
```

Call existing TTS config with default measurement speed `1.7`, read real audio duration, then compute:

```js
const ratio = videoTotalDuration / targetDurationSec;
```

Keep full internal precision; round only for display.

- [ ] **Step 4: Enforce first-version safety rule**

If `videoTotalDuration < targetDurationSec`, mark measurement invalid and show the missing seconds. Do not generate `<1x` slow-motion merge automatically.

If valid, final merge speed is the measured ratio.

- [ ] **Step 5: Prove no TTS audio enters merge payload**

Add source contract assertion that `mergeBatchFactoryVideos` receives `projectId/bookId/mediaIds/speed` and no `audio`, `audioBlob`, `audioUrl`, or `ttsTrack` field.

- [ ] **Step 6: Run targeted tests/build**

```bash
node --test tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/user/pages/BatchFactoryPageV9.jsx frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx tests/batch-factory-workbench-ui-contract.test.js
git commit -m "fix(batch-factory): consolidate merge and TTS timing"
```

---

### Task 10: Wire Video Management System runtime state without fake login behavior

**Files:**
- Modify: `lib/batch-factory/video-management-account.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `app.js`
- Modify: `server.js`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx`
- Modify: `tests/batch-factory-video-management-account.test.js`

**Interfaces:**
- Adapter contract consumed by batch factory:

```js
{
  getStatus({ username }) -> Promise<{ online, accountName?, expired?, message? }>,
  startRelogin({ username }) -> Promise<{ loginUrl }>
}
```

- Normalized API states remain `online | login_required | unavailable`.

- [ ] **Step 1: Extend tests for three visibly different states**

Required behavior:

```text
online -> blue dot + account name + 账号在线, no relogin button
login_required -> 登录异常 + 账号登录状态已失效 + 重新登录
unavailable -> 视频管理系统暂不可用 + reason, no fake relogin button unless adapter explicitly supplies a real login URL/start capability
```

- [ ] **Step 2: Trace the Novel Fetch account/login implementation before wiring**

Search the repository for the existing external-login/session logic used by Novel Fetch using concrete signals: its status endpoint, cookie/session store, login URL builder, and display-name resolver. Read that implementation completely before adapting it.

Do not build a second credential store.

- [ ] **Step 3: Create a thin adapter at server startup**

`server.js` must no longer always call bare `createApp()` if a reusable Novel Fetch adapter exists. Construct the adapter from the existing runtime and pass:

```js
createApp({ videoManagementAccountAdapter })
```

If the existing Novel Fetch login logic cannot be safely exposed as an adapter, keep `null` and return `unavailable`; do not invent endpoints or credentials.

- [ ] **Step 4: Make publish drawer render `unavailable` separately**

Do not use error/red `登录异常` for adapter-unavailable. Use warning/info state with the backend reason. Only `login_required` gets `重新登录`.

- [ ] **Step 5: Keep auto-validation on drawer open and relogin polling**

Online stops polling. Relogin opens only a real adapter-provided URL and rechecks until online/window closes.

- [ ] **Step 6: Run account tests/build**

```bash
node --test tests/batch-factory-video-management-account.test.js
npm run frontend:build
```

- [ ] **Step 7: Commit**

```bash
git add lib/batch-factory/video-management-account.js routes/batch-factory-controls.js app.js server.js frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx tests/batch-factory-video-management-account.test.js
git commit -m "fix(batch-factory): wire video management runtime account state"
```

---

### Task 11: Remove fake/duplicate controls and preserve publish-version ownership

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx`
- Modify: `tests/batch-factory-constraints-ui-contract.test.js`
- Modify: `tests/batch-factory-publish-config-version-store.test.js`

**Interfaces:**
- Production unified settings owns production only.
- Publish unified settings owns publish version selection/sync and `{ materialReuse, horizontalFlip }`.

- [ ] **Step 1: Reassert production/publish ownership in tests**

Production Drawer must not contain version sync. Publish Drawer must contain `版本配置`, `同步最新配置`, `视频管理系统`, `不复用/复用`, `不翻转/翻转` and must not contain `解压视频数量` or `AI头部`.

- [ ] **Step 2: Remove disabled fake publish primary button from workbench**

If real publish API is absent, render a capability panel:

```text
发布到视频管理系统
当前发布接口尚未接通
成片与 TXT 已准备：{bookId}.mp4 + {bookId}.txt
```

Do not show a primary button that is permanently disabled.

- [ ] **Step 3: Do not surface backend-only admin version CRUD as if it exists in user UI**

User-facing publish Drawer only consumes published versions. Admin UI remains a separate future/admin task unless already implemented elsewhere.

- [ ] **Step 4: Run publish/UI tests/build**

```bash
node --test tests/batch-factory-constraints-ui-contract.test.js tests/batch-factory-publish-config-version-store.test.js tests/batch-factory-workbench-ui-contract.test.js
npm run frontend:build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/BatchFactoryPageV9.jsx frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx frontend/src/user/pages/batch-factory/BatchFactoryWorkbenchCards.jsx tests/batch-factory-constraints-ui-contract.test.js tests/batch-factory-publish-config-version-store.test.js tests/batch-factory-workbench-ui-contract.test.js
git commit -m "fix(batch-factory): remove placeholder controls and clarify ownership"
```

---

### Task 12: Repair stale test contracts, run full verification, and review the PR

**Files:**
- Modify only failing tests or implementation files demonstrated by current full-suite evidence.
- Potentially modify: old Novel Fetch/batch intake test fixtures that still call removed/renamed routes.
- Verify: `.github/workflows/pr-node-tests.yml`

**Interfaces:**
- Final gate: complete root test suite + frontend production build.

- [ ] **Step 1: Run the full test suite once and capture exact remaining failures**

```bash
npm test
```

Do not start patching from memory. Group failures by root cause: stale route fixture, real regression, or changed product contract.

- [ ] **Step 2: For each remaining failure, compare against the current route/interface before editing**

For stale Novel Fetch fixtures, update the fixture to the current public route rather than restoring removed endpoints solely to satisfy an old test.

For a real regression, write/keep the failing reproduction and fix the implementation source.

- [ ] **Step 3: Re-run only the affected test file after each root-cause fix**

Example:

```bash
node --test tests/<failing-file>.test.js
```

Expected: PASS before moving to the next independent failure group.

- [ ] **Step 4: Run complete tests**

```bash
npm test
```

Expected: 0 failures.

- [ ] **Step 5: Run frontend build**

```bash
npm run frontend:build
```

Expected: successful Vite production build with no unresolved imports/syntax errors.

- [ ] **Step 6: Perform manual workbench acceptance in both themes**

Checklist:

```text
Dark -> Light -> Dark: no unreadable Tag/Alert/Select/Segmented/disabled text
Status chip click: right 当前筛选 changes, status card height does not grow
Filtered book click: book selection changes; abnormal section focuses failing step
Normal mode: cards cannot accidentally move
编辑布局: drag/resize/collapse/hide/maximize work
取消: unsaved layout changes revert
保存布局: reload retains desktop layout
恢复默认布局: confirmation then default grid returns
Sidebar collapse/expand: workspace recalculates without clipping
Small width: auto two/one-column fallback without overwriting desktop layout
VIDEO preview: all rows switch the same single player
Final merge preview and raw VIDEO preview share the same player
Fixed single VIDEO does not silently change duration to model max
Legacy constraint bodies display enabled when old flag is missing
Publish drawer: account states online/login_required/unavailable are distinct
No fake publish CTA
TTS timing: measurement only; no TTS audio in final merge
```

- [ ] **Step 7: Push and observe PR CI at the final head SHA**

Confirm `PR Node Tests` runs both steps:

```text
npm test -> success
npm run frontend:build -> success
```

- [ ] **Step 8: Review PR diff for scope creep**

Reject unrelated refactors. Verify no new Prompt Studio, no second player, no raw system prompt body in production UI, no provider `@imageN` syntax stored in business data, and no TTS audio merge.

- [ ] **Step 9: Final commit if verification fixes changed files**

```bash
git add <only verified affected files>
git commit -m "test(batch-factory): restore full regression suite"
```

Do not merge PR #8 unless the user explicitly requests the merge.
