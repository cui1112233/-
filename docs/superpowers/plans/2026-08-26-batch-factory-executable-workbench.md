# Batch Factory Executable Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the screenshot-matched batch-factory page into a four-column, user-resizable workbench backed by the existing batch production APIs.

**Architecture:** Keep the existing batch-factory orchestration, director, prompt compiler, production and merge APIs as the single workflow. Extract the visible workbench from the static preview into focused React components, add the intake and settings contracts required by the confirmed UX, and persist new batch-facing state through the project data layer rather than browser-only state.

**Tech Stack:** React/Vite, Ant Design, Lucide, Express, Node test runner, existing Shuihuo production APIs, MySQL repository.

## Global Constraints

- `/batch-factory` is not a global navigation item; enter from water production and return there.
- Preserve the screenshot workbench hierarchy: title/batch bar, status center, four resizable columns, one video player.
- Use semantic theme tokens: purple focus/primary, red failure, orange pending, blue queued/processing, green complete, gray neutral.
- Do not implement external publishing/upload in this phase.
- Video duration must be validated against the selected model on both client and server.
- Preserve unrelated dirty files and never commit runtime data or credentials.

---

### Task 1: Write import parsing and duplicate-validation contracts

**Files:**
- Create: `frontend/src/user/pages/batch-factory/intake.js`
- Modify: `tests/batch-factory-workbench-ui.test.js`
- Test: `test/batch-factory.test.js`

**Interfaces:**
- Produces `parseManualNovels(text)`, `fileToDraft(fileName, sourceText)`, `validateDraftItems(items)`.
- A draft item is `{ title, bookId, sourceText, txtText, sourceType, duplicateFields }`.

- [ ] **Step 1: Write failing parser tests**
```js
assert.deepEqual(parseManualNovels('1\n标题甲\n正文\n\n2\n标题乙\n正文'), [
  { title: '标题甲', bookId: '', sourceText: '标题甲\n正文' },
  { title: '标题乙', bookId: '', sourceText: '标题乙\n正文' }
]);
assert.deepEqual(parseManualNovels('10001\n标题甲\n正文'), [
  { title: '标题甲', bookId: '10001', sourceText: '标题甲\n正文' }
]);
```
- [ ] **Step 2: Run `node --test test/batch-factory.test.js` and verify the test fails because the parser does not exist.**
- [ ] **Step 3: Implement the pure helpers**
```js
export function fileToDraft(fileName, sourceText) {
  const stem = fileName.replace(/\.(txt|md)$/i, '');
  return { title: /^\d+$/.test(stem) ? firstLine(sourceText) : stem, bookId: /^\d+$/.test(stem) ? stem : '', sourceText, txtText: sourceText, sourceType: 'manual' };
}
```
- [ ] **Step 4: Add validation tests for empty text, nonnumeric IDs, duplicate title and duplicate Book ID; run the focused tests green.**
- [ ] **Step 5: Commit only the helper and tests: `feat: add batch factory intake parsing`.**

### Task 2: Add batch mutations and intake handoff contracts

**Files:**
- Modify: `lib/batch-factory/store.js`, `routes/batch-factory.js`, `routes/batch-factory-intake.js`, `frontend/src/shared/api/batchFactory.js`
- Test: `test/batch-factory.test.js`

**Interfaces:**
- `POST /api/batch-factory/batches/:batchId/items/settings` accepts `{ itemIds, settings, overrideMode }`.
- `POST /api/batch-factory/intakes/novel-fetch` creates a batch directly when `createBatch: true`.

- [ ] **Step 1: Write failing route/store tests for direct novel-fetch creation and scoped settings application.**
```js
assert.equal(batch.items[0].settingsOverride, true);
assert.equal(batch.items[1].settings.videoModelId, 23);
```
- [ ] **Step 2: Run `node --test test/batch-factory.test.js` and verify missing mutation behavior fails.**
- [ ] **Step 3: Implement store and routes with user ownership checks, locked-item rejection, override preservation, and activity-log entries.**
- [ ] **Step 4: Run focused route/store tests green.**
- [ ] **Step 5: Commit: `feat: add batch factory intake and scoped settings APIs`.**

### Task 3: Replace static preview with a four-column interactive shell

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`, `frontend/src/user/pages/batch-factory-workbench.css`
- Create: `frontend/src/user/pages/batch-factory/StatusNavigator.jsx`, `frontend/src/user/pages/batch-factory/ResizableWorkbench.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`

**Interfaces:**
- `StatusNavigator({ rows, activeStatus, activeIndex, onLocate })` returns matching rows and cycles selection.
- `ResizableWorkbench({ storageKey, children })` persists per-user four-column ratios and exposes reset.

- [ ] **Step 1: Write failing UI contract tests for four named columns, one `<video>` viewport, current-filter panel, and resize handles.**
- [ ] **Step 2: Run `node --test tests/batch-factory-workbench-ui.test.js` and verify failures against the static preview.**
- [ ] **Step 3: Render real batch state instead of the early `return <BatchFactoryPreviewPage />`, preserve existing API polling, and place content in list/content/video/progress columns.**
- [ ] **Step 4: Implement status click cycling: a new status selects its first matching row; repeat click advances modulo match count; the list scrolls to and retains all rows.**
- [ ] **Step 5: Run UI contracts and `npm --prefix frontend run build`; commit `feat: render executable batch factory workbench`.**

### Task 4: Add draft intake modal and direct novel-fetch navigation

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`, `frontend/src/user/pages/NovelFetchPage.jsx`, `frontend/src/user/pages/NovelFetchWorkshopPage.jsx`
- Create: `frontend/src/user/pages/batch-factory/BatchIntakeDrawer.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`, `test/batch-factory.test.js`

- [ ] **Step 1: Write failing tests asserting TXT/MD-only input, editable title/ID drafts, duplicate-confirmation dialog, and novel-fetch action calling the intake API.**
- [ ] **Step 2: Run the focused tests and observe the missing action/drawer failures.**
- [ ] **Step 3: Implement mixed paste/file import preview and use the Task 1 helpers; direct novel-fetch creates and opens a batch without preview.**
- [ ] **Step 4: Run focused tests and frontend build green.**
- [ ] **Step 5: Commit: `feat: connect batch factory intake sources`.**

### Task 5: Add scoped production-settings Drawer

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`, `frontend/src/shared/api/batchFactory.js`
- Create: `frontend/src/user/pages/batch-factory/ProductionSettingsDrawer.jsx`
- Test: `tests/batch-factory-workbench-ui.test.js`, `test/batch-factory.test.js`

- [ ] **Step 1: Write failing tests for right-side Drawer, scope choices, fixed duration choices bounded by `maxVideoDuration`, and publish control disabled.**
- [ ] **Step 2: Run focused tests and verify they fail before the Drawer exists.**
- [ ] **Step 3: Implement Drawer form, advanced collapsed sections, model-change compatibility confirmation, and preserve/force single-book override confirmation.**
- [ ] **Step 4: Submit scoped changes through Task 2 API, then refresh the active batch; run tests and frontend build green.**
- [ ] **Step 5: Commit: `feat: add scoped batch production settings drawer`.**

### Task 6: Finish single-player, production, merge, and verification

**Files:**
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`, `frontend/src/user/pages/BatchFactoryPage.jsx`, `frontend/src/user/pages/batch-factory-workbench.css`
- Test: `test/batch-factory.test.js`, `tests/batch-factory-workbench-ui.test.js`, relevant Go merge tests

- [ ] **Step 1: Write failing tests proving the selected VIDEO and merged output share one player, and switching books does not affect aggregate progress.**
- [ ] **Step 2: Run tests to verify missing shared-player behavior fails.**
- [ ] **Step 3: Implement player source selection, merged-output tab, per-card retry/regenerate controls, and semantic state tokens.**
- [ ] **Step 4: Run Node tests, UI tests, Go merge tests, frontend build, Docker compose config, Docker health and HTTP checks.**
- [ ] **Step 5: Commit: `feat: complete batch factory production workbench`.**

## Self-Review

- Spec coverage: Tasks 1-2 cover intake and settings data, Tasks 3-5 cover the confirmed workbench and settings interaction, Task 6 covers playback/production/merge. External publishing remains deliberately out of scope.
- Placeholder scan: no deferred implementation steps are used within task deliverables.
- Type consistency: all client settings mutations use `itemIds`, `settings`, and `overrideMode`; item drafts use the Task 1 shape throughout.
