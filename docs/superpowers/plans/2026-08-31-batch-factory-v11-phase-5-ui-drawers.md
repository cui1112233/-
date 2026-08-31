# Batch Factory V11 Phase 5 UI And Drawers Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This plan is executed in the dedicated frontend worktree, not in the Go Foundation worktree.

**Goal:** 在 V78 可重建前端上选择性迁入成熟的 V11 React/Ant Design 工作台、Drawer、Book/VIDEO 设置和 Inline Constraints，同时将所有可操作数据读写改接 Go V11 API；V78 Preview 仍可从 `/batch-factory-preview` 明确访问。

**Architecture:** `/batch-factory` 使用 `BatchFactoryV11UiPage`，该页面只经 `frontend/src/shared/api/batchFactoryV11.js` 请求同源 `/api/batch-factory/v11/*`。UI layout、Drawer、CSS、状态展示和 local layout persistence 可以复用；Batch/Book/VIDEO persistence、继承、catalog、Prompt、Director、生产、状态和合并只能由 Go capabilities 与 V11 API 决定。API 失败显示明确错误，不得读旧 `/api/batch-factory/*` 或展示示例业务数据。

**Tech Stack:** React 18、Ant Design 5、Lucide React、Vite 5、Node test runner、Go V11 API、browser visual acceptance in Phase 6.

## Global Constraints

- V78 source baseline is `recovery/production-v78.3.0.3-source@483faed8d654e452f6079fc1ef40b74db3a13d1c`; UI source is `origin/feat/batch-factory-v11-layout-showcase@59afd75da3d9b96b908b849931c5f28289a674d9`.
- Use the V78 files `frontend/src/user/pages/BatchFactoryPage.jsx`, `BatchFactoryPreviewPage.jsx`, `batch-factory-workbench.css`, `batch-factory/BatchFactoryProductionControls.jsx`, `BatchFactoryBulkProduction.jsx`, `BatchFactoryVideoProductionStatus.jsx`, `batch-factory/intake.js`, and `batch-factory/workbenchState.js` only as integration/fallback context. Do not call their old data APIs from V11.
- Selectively restore V11 page/layout assets listed below. Do not restore `showcaseData.js`, do not copy `BatchFactoryPageV10.jsx`, do not import `frontend/src/shared/api/batchFactory.js`, and do not use any old Node Batch Store, effective-settings, Prompt Compiler, production bridge, or 08/09/10 business rule.
- Every copied/changed UI asset must have a row in `docs/batch-factory/v11-source-provenance.tsv` with source branch, source commit, source blob SHA, purpose, and transformation. UI code may be rewritten to remove demo data and update API names; the row must say so.
- The only source of enabled state is `GET /api/batch-factory/v11/capabilities`. The client must use `production.submit`, never `production.run`. A visible control without an available capability is disabled and has a short unavailable reason.
- Production settings Drawer order is fixed: configuration version, basic production settings, then constraints. Constraints expand inline when enabled; closing a toggle retains the draft but excludes it from later compiler input.
- Book/VIDEO sparse override restore deletes only the chosen key. It never copies inherited parent values, coerces `false`, empties an empty string, or converts `0` to an absent key.
- System presets, personal prompts, and drafts load from Go endpoints; static options and hardcoded prompt text cannot become a fallback source of truth. Before the prompt catalog API is available, the corresponding save/create actions remain disabled.
- One unified player container must exist in the workbench. Book status filter selection must update the right-side current-filter results. Workspace layout may persist only the UI layout key `qiantie:batch-factory:layout:v1`; it must not persist Batch Factory business data in localStorage.
- `/batch-factory-preview` remains V78 Preview. A V11 API error must remain visible on `/batch-factory`; automated fallback to Preview or a legacy Node request is forbidden.
- 121/Yadi are visible only as unavailable states. They have no active submit handler, credential field, request, or external effect in this phase.

## File Structure

- Modify: `frontend/src/user/App.jsx` to lazy-load V11 for `/batch-factory` and retain its existing `/batch-factory-preview` route.
- Replace the current early-return wrapper in `frontend/src/user/pages/BatchFactoryPage.jsx` with a small V11 page wrapper; retain `BatchFactoryPreviewPage.jsx` unchanged as fallback.
- Restore selectively from `59afd75`: `frontend/src/shared/api/batchFactoryV11.js`, `batchFactoryV11State.js`, `bf11Runtime.js`, `bf11UiAdapter.js`, `saveFlow.js`, `workspace-layout.js`, `WorkbenchCard.jsx`, `BatchFactoryV11UiPage.jsx`, `BatchFactoryV11Workbench.jsx`, `BatchFactoryV11SettingsDrawers.jsx`, `BatchFactoryV11ScopedSettings.jsx`, `BatchFactoryV11ConstraintEditor.jsx`, `ChangeImpactNotice.jsx`, `OverrideCompatibilityDetails.jsx`, `FixedSingleVideoControl.jsx`, `DirectorPanel.jsx`, `DirectorRefreshContext.jsx`, `HookReviewPanel.jsx`, `BatchFactoryV11BatchManager.jsx`, `BatchFactoryV11PublishSettings.jsx`, their focused tests, and their V11 CSS files.
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `bf11UiAdapter.js`, `bf11Runtime.js`, `BatchFactoryV11UiPage.jsx`, `BatchFactoryV11Workbench.jsx`, `BatchFactoryV11BatchManager.jsx`, and `BatchFactoryV11PublishSettings.jsx` to remove showcase behavior and bind only available Go capabilities.
- Create: `frontend/src/user/pages/batch-factory-v11/v11-api-boundary.test.js`, `route-contract.test.js`, `capability-gating.test.js`, and any focused test named in the tasks below.

### Task 1: Establish selective UI provenance and a no-legacy boundary

**Interfaces:**

- `frontend/src/shared/api/batchFactoryV11.js` is the only API module imported by V11 page files.
- `assertV11ApiBoundary(source string) error` in the source test rejects legacy V11 imports, `/api/batch-factory/` paths without `/v11/`, demo payload imports, and `production.run`.
- `docs/batch-factory/v11-source-provenance.tsv` records every copied UI file before it is modified.

- [ ] **Step 1: Write failing boundary tests**

Create `frontend/src/user/pages/batch-factory-v11/v11-api-boundary.test.js` that reads the V11 source directory and asserts all of the following:

~~~text
every V11 API request path begins /api/batch-factory/v11/
no V11 page imports ../../shared/api/batchFactory or imports showcaseData
no V11 source contains production.run
BatchFactoryV11BatchManager has no hardcoded HISTORY array
BatchFactoryV11PublishSettings has no enabled save or sync action before publish capability exists
~~~

Run from the frontend directory:

~~~bash
node --test src/user/pages/batch-factory-v11/v11-api-boundary.test.js
~~~

Expected: FAIL before selective files are restored and stripped of showcase behavior.

- [ ] **Step 2: Restore only declared UI assets and record blobs**

From a frontend implementation worktree based on the approved design SHA, run `git restore --source=59afd75da3d9b96b908b849931c5f28289a674d9 --` followed by the exact files listed under File Structure. For every restored file, record its blob using this command:

~~~bash
git rev-parse 59afd75da3d9b96b908b849931c5f28289a674d9:frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx
~~~

Use the same command form for every V11 file and record whether it was unchanged, stripped of static data, renamed, or rebound to a Go API call. Do not restore the entire `frontend/src` tree.

- [ ] **Step 3: Remove demo data and normalize capability names**

Delete imports of `showcaseData.js`; convert `BatchFactoryV11BatchManager` to receive real `intake`, `batches`, loading/error state, and callbacks as props; convert `BatchFactoryV11PublishSettings` to present disabled fields/save action until Go publish capabilities exist; change every `production.run` action check to `production.submit`; and remove any static model/config/prompt list that could save business state.

- [ ] **Step 4: Run boundary tests and commit**

~~~bash
node --test src/user/pages/batch-factory-v11/v11-api-boundary.test.js src/shared/api/batchFactoryV11.test.js
git add frontend/src/user/pages/batch-factory-v11 frontend/src/shared/api/batchFactoryV11.js docs/batch-factory/v11-source-provenance.tsv
git commit -m "feat(batch-v11-ui): restore audited V11 workbench assets"
~~~

### Task 2: Bind the V11 client, runtime, and router to Go Slice 1

**Interfaces:**

- `batchFactoryV11.js` exports `getCapabilities`, `listBatches`, `getBatch`, `createNovelFetchIntake`, `getIntake`, `createBatchFromIntake`, `saveBatchSettings`, `saveBookOverride`, `saveVideoOverride`, `getConfigVersions`, `getChangeImpact`, `listPrompts`, `createPrompt`, `getDraft`, and `saveDraft`.
- `createBf11UiAdapter(api).loadWorkbench({batchId, intakeId})` loads capability, batches, config versions, selected Batch, and intake only from V11 routes.
- `createBf11Runtime({adapter}).save(input)` preserves sparse values and turns a `409` into an open-Drawer conflict result rather than discarding edits.
- `UserApp` routes `/batch-factory` to V11 and `/batch-factory-preview` to existing Preview with no dynamic fallback between them.

- [ ] **Step 1: Write failing client/runtime/route tests**

Add tests that intercept `apiRequest` and prove these exact behaviors:

~~~text
GET capabilities occurs before enabled action state is derived
loadWorkbench requests V11 batches and config versions in parallel, then requests only the selected V11 batch
an API 404 or 503 produces runtime phase error and does not call a legacy route
saveBookOverride serializes false, empty string, and zero in patch JSON
a 409 keeps the drawer callback result false and includes a refresh message
/batch-factory resolves BatchFactoryV11UiPage while /batch-factory-preview resolves BatchFactoryPreviewPage
~~~

Run:

~~~bash
node --test src/shared/api/batchFactoryV11.test.js src/user/pages/batch-factory-v11/bf11Runtime.test.js src/user/pages/batch-factory-v11/bf11UiAdapter.test.js src/user/pages/batch-factory-v11/route-contract.test.js
~~~

Expected: FAIL until routes and adapter behavior are updated.

- [ ] **Step 2: Implement API-only runtime wiring**

Rename `toV10ViewBatch` to `toWorkbenchBatch` to remove the historical UI coupling. Map only documented Go response fields, including `settingsState`, `compatibility`, `configVersions`, `mediaUrl`, `mergedUrl`, and status projections. When the V11 request fails, render the existing retry/error state with its response status; do not populate list/detail cards from a legacy API response or local showcase record.

In `UserApp`, lazy-load `BatchFactoryV11UiPage` for `/batch-factory`. In `BatchFactoryPage.jsx`, render the V11 page wrapper and delete the unreachable old workbench implementation rather than leaving it as a second implicit path. Do not change `BatchFactoryPreviewPage.jsx` or its route.

- [ ] **Step 3: Run focused tests and commit**

~~~bash
node --test src/shared/api/batchFactoryV11.test.js src/user/pages/batch-factory-v11/bf11Runtime.test.js src/user/pages/batch-factory-v11/bf11UiAdapter.test.js src/user/pages/batch-factory-v11/route-contract.test.js
git add frontend/src/user/App.jsx frontend/src/user/pages/BatchFactoryPage.jsx frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11-ui): route workbench to Go V11 APIs"
~~~

### Task 3: Make Batch, Book, VIDEO, Drawer, and constraint settings operable from Go Slice 1

**Interfaces:**

- `ProductionSettingsDrawer` receives server config versions and calls `onSave` or `onSyncConfigVersion` with sparse patch values only.
- `BookSettingsModal` and `VideoSettingsDrawer` receive a current `settingsState` and express inheritance by omitting a restored key from their outbound patch plus adding it to `restoreKeys`.
- `BatchFactoryV11ConstraintEditor` stores drafts in its parent form state. An enabled constraint immediately renders its editor; disabled constraints retain their draft but compile as disabled.
- `ChangeImpactNotice` displays the Go `ChangeImpact`, including affected counts, Director invalidation, preserved overrides, and per-VIDEO compatibility.

- [ ] **Step 1: Write failing settings interaction tests**

Add `settings-go-contract.test.js`, `drawer-order-source.test.js`, and `workbench-interaction.test.js` with these assertions:

~~~text
production Drawer sections appear in configuration version, basic production settings, constraints order
model/config/mode/fixed-single change renders the Go-provided dynamic Director warning; no hardcoded 46 count exists
Book and VIDEO restore buttons send restoreKeys containing only the field being restored
an enabled quality, restriction, or negative constraint renders its text editor immediately without an edit icon click
a disabled constraint retains draft text in component state and does not enable prompt-library persistence
book selection changes the active workbench Book; VIDEO selection changes the active VIDEO
status center selection updates right-side current-filter rows
the workbench contains exactly one data-bf-player unified player container
layout save/reset uses only qiantie:batch-factory:layout:v1 and leaves API data out of localStorage
~~~

Run:

~~~bash
node --test src/user/pages/batch-factory-v11/settings-go-contract.test.js src/user/pages/batch-factory-v11/drawer-order-source.test.js src/user/pages/batch-factory-v11/workbench-interaction.test.js src/user/pages/batch-factory-v11/workspace-layout.test.js
~~~

Expected: FAIL until Drawer callbacks and V11 data props replace static/demo assumptions.

- [ ] **Step 2: Implement Go Slice 1 UI wiring**

Wire `BatchFactoryV11UiPage` to the V11 runtime for list/select/create-from-intake, production settings, config version sync, Book override, VIDEO override, and Go change-impact preview. Keep the Drawer open on failed save or revision conflict. Render the server's catalog/model/config values; if a catalog response is unavailable, disable its dependent save/sync button and show the returned failure message rather than a static substitute.

For the local layout only, keep `workspace-layout.js` behavior and fixed dimensions. Route all batch data through props loaded by the runtime. Ensure the current filter produces a right-side list from the selected status and there is only one preview player element even while switching Books or VIDEO tabs.

- [ ] **Step 3: Run V11 UI test suite and commit**

~~~bash
node --test src/user/pages/batch-factory-v11/*.test.js src/shared/api/batchFactoryV11.test.js
git add frontend/src/user/pages/batch-factory-v11 frontend/src/shared/api/batchFactoryV11.js
git commit -m "feat(batch-v11-ui): wire Go settings snapshots and overrides"
~~~

### Task 4: Attach Director, Hook, effective settings, and Final Prompt only after Phase 3

**Interfaces:**

- The V11 client adds only the Phase 3 endpoints for Hook latest/start/approval, Director latest/start, effective settings, and final-prompt preview.
- `HookReviewPanel`, `DirectorPanel`, and `DirectorRefreshContext` call these endpoints only when `hook.review`, `director.run`, `settings.resolve`, or `prompt.compile` reports available.
- The Final Prompt panel displays the returned Go `hash`, `snapshotId`, `directorRevisionId`, and asset references; it does not build a prompt in React.

- [ ] **Step 1: Write failing Director/Prompt UI tests**

Add tests proving that viral mode shows an approved Hook prerequisite, original mode does not require it, unavailable Director execution remains disabled with the Go reason, a valid Final Prompt preview renders only Go response fields, and an incompatible/orphaned VIDEO disables prompt preview and links to compatibility details.

Run:

~~~bash
node --test src/user/pages/batch-factory-v11/director-ui-source.test.js src/user/pages/batch-factory-v11/director-revision-refresh-source.test.js src/user/pages/batch-factory-v11/override-compatibility-source.test.js src/user/pages/batch-factory-v11/no-effective-settings-source.test.js
~~~

Expected: FAIL until Phase 3 route client methods and capability gating are present.

- [ ] **Step 2: Bind Phase 3 controls without adding client rules**

Pass the Go-provided mode, Hook status, Director revision, effective settings, compatibility, and compiled prompt to panels. The UI may format these records but cannot infer compatibility, build a director contract, calculate model duration, or concatenate prompt text. `Final Prompt` and `Director` action buttons call the V11 client once and refresh the runtime from Go afterward.

- [ ] **Step 3: Run tests and commit after the Phase 3 SHA is accepted**

~~~bash
node --test src/user/pages/batch-factory-v11/director-ui-source.test.js src/user/pages/batch-factory-v11/director-revision-refresh-source.test.js src/user/pages/batch-factory-v11/override-compatibility-source.test.js src/user/pages/batch-factory-v11/no-effective-settings-source.test.js
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11-ui): bind Go Director and final prompt controls"
~~~

### Task 5: Attach Production, Status, and Merge only after Phase 4

**Interfaces:**

- V11 client methods are `submitProduction`, `getBatchProductionStatus`, `getBookProductionStatus`, `getProductionSubmission`, `getMergeCapability`, `createMergeRun`, and `getLatestMergeRun`.
- `BatchFactoryV11Workbench` uses `production.submit` and `merge.run` capability records to enable controls; it does not poll a Node project or infer terminal status from a button click.
- Status center receives Go `BatchProductionStatus`; merge UI receives Go `MergeCapability` and latest MergeRun.

- [ ] **Step 1: Write failing production/status/merge UI tests**

Create tests that assert a disabled candidate leaves production and merge actions disabled; enabled action handlers call only V11 client methods; polling refreshes Go status projection after a bounded interval; a provider failure displays persisted failure code; and a successful merge updates only the affected Book's merged media reference without replacing the unified player component.

Run:

~~~bash
node --test src/user/pages/batch-factory-v11/production-status-source.test.js src/user/pages/batch-factory-v11/merge-source.test.js src/user/pages/batch-factory-v11/workbench-interaction.test.js
~~~

Expected: FAIL until the Phase 4 V11 methods are wired.

- [ ] **Step 2: Bind Go production and merge projections**

Use a single effect with cleanup to poll `getBatchProductionStatus` only while Go reports active statuses. Respect the server-provided capability reason and never synthesize a completed status. On submit/merge, keep the control disabled while the V11 request is outstanding, then refresh only from Go. Preserve the existing one-player layout and use Go media URLs only after their corresponding status is succeeded.

- [ ] **Step 3: Run tests and commit after the Phase 4 SHA is accepted**

~~~bash
node --test src/user/pages/batch-factory-v11/production-status-source.test.js src/user/pages/batch-factory-v11/merge-source.test.js src/user/pages/batch-factory-v11/workbench-interaction.test.js
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11-ui): bind Go production status and merge"
~~~

### Task 6: Verify visual integrity and V78 route preservation

- [ ] **Step 1: Build from a clean frontend install**

~~~bash
npm --prefix frontend ci
npm --prefix frontend run build
~~~

Expected: PASS with no missing V11 import or CSS asset.

- [ ] **Step 2: Run source and route regressions**

~~~bash
node --test frontend/src/user/pages/batch-factory-v11/*.test.js frontend/src/shared/api/batchFactoryV11.test.js
~~~

Expected: PASS. The source scan must confirm that V11 contains no legacy Batch API import, no static showcase data, and no `production.run` capability.

- [ ] **Step 3: Perform candidate visual checks after Phase 6 starts**

At the isolated candidate URL, inspect desktop and mobile widths for dark text contrast, no white gutters between workbench panels, readable Tag/Tab/Button/Input text, all three settings surfaces opening, Book/VIDEO switch behavior, right-side status filtering, one player, layout save/reset, and inline constraint expansion. Record screenshots and the candidate image SHA in the acceptance report; this step never changes `:3000`.

## Phase Gate

- [ ] `/batch-factory` is V11-only and `/batch-factory-preview` remains V78 Preview-only.
- [ ] All data reads/writes use `batchFactoryV11.js` and V11 APIs. API errors do not call an old endpoint or show a demo batch.
- [ ] Phase 2 capabilities make Batch/Book/VIDEO Settings and Snapshot controls operational; unavailable later capabilities remain disabled with reasons.
- [ ] Phase 3 and Phase 4 UI commits are not made until their respective Go SHA and contract tests are accepted.
- [ ] The full V11 front-end test suite and clean Vite build pass; V78 login, home, novel-fetch, settings, and Preview routes remain covered in candidate acceptance.
- [ ] No Node business rule, formal data, provider credential, 121/Yadi request, or `:3000` mutation is introduced by this phase.
