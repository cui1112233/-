# Batch Factory V11 V78 UI Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the final Batch Factory V11 user interface directly inside the V78 React shell so the user can review the real production layout and interactions before business logic is connected.

**Architecture:** Keep the V78 React 18 + Ant Design 5 + Vite 5 application shell. `/batch-factory` renders a new production-grade `BatchFactoryV11Workbench` driven only by local showcase state during Phase 1; no old Batch Factory Node APIs, no Go V11 calls, no provider calls, no 121 calls. The same components remain in place for Phase 2, where the showcase adapter is replaced by the existing `bf11UiAdapter` and `/api/batch-factory/v11/*` client.

**Tech Stack:** React 18.3.1, Ant Design 5.21.6, lucide-react, Vite 5.4.8, native pointer events, CSS Grid, browser localStorage.

**Spec:** `docs/batch-factory/BATCH_FACTORY_COMPLETE_DESIGN_AND_BRANCH_MAP.md`, plus `00-AI必读-批量工厂产品记忆.md` and `01-批量工厂需求决策表.md` as product authority.

## Global Constraints

- Must compile in the recovered V78 frontend without upgrading React, Ant Design, Vite, or adding dependencies.
- Reuse the existing `UserApp`, `UserLayout`, route mechanism, theme variables, and V78 build structure.
- Do not reuse old `shared/api/batchFactory`, `shared/api/generation`, or `shared/api/shuihuoProduction` from the new V11 UI path.
- Phase 1 is final UI, not a disposable mock page. Components created here remain the Phase 2 production components.
- Phase 1 local showcase data is clearly isolated in `showcaseData.js`; production components do not contain hard-coded business records.
- Normal mode locks layout. Explicit Edit Layout mode enables move/resize/collapse/maximize/hide; Save Layout persists to `qiantie:batch-factory:layout:v1` and Restore Default resets it.
- Product priorities are batch-first, exception-first, progressive disclosure.
- One workspace player only: Final Merge / VIDEO 01 / VIDEO 02 / ... switch the same preview surface.
- Status center is a filter only; filtered books render in the separate Current Filter card, never below the status center.
- Production Unified Settings is a wide right Drawer in this order: Config Version -> Basic Production Settings -> Constraints.
- Constraint switches expand the editor inline. No pencil-only second-level editor.
- Book and VIDEO settings represent `system < batch < book < video` inheritance and expose restore-inheritance UI.
- Phase 1 buttons may update local showcase state, but must not issue network writes or simulate provider success notifications.
- Do not modify `master`, `:3000`, production images, databases, or 121 integration in Phase 1.

---

### Task 1: V78-Compatible Workspace Layout Engine

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/workspace-layout.test.js`
- Create: `frontend/src/user/pages/batch-factory-v11/workspace-layout.js`

**Interfaces:**
- Produces `DEFAULT_WORKSPACE_LAYOUT`, `mergeWorkspaceDefaults`, `moveWorkspaceItem`, `resizeWorkspaceItem`, `setWorkspaceItemHidden`, `setWorkspaceItemCollapsed`, `setItemMaximized`, `WORKSPACE_STORAGE_KEY`.

- [ ] Step 1: Write failing `node:test` coverage for 12-column defaults, minimum sizes, reset behavior, hidden/collapsed/maximized state, and persistence schema.
- [ ] Step 2: Run `node --test frontend/src/user/pages/batch-factory-v11/workspace-layout.test.js`; verify RED because module is missing.
- [ ] Step 3: Implement the audited historical 12-column helper without React dependencies.
- [ ] Step 4: Run the focused test and verify PASS.
- [ ] Step 5: Commit `feat(batch-v11): add V78 workspace layout engine`.

### Task 2: Final Workbench Frame

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/showcaseData.js`
- Create: `frontend/src/user/pages/batch-factory-v11/WorkbenchCard.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/batch-factory-v11.css`
- Create: `frontend/src/user/pages/batch-factory-v11/workbench-source.test.js`

**Interfaces:**
- `BatchFactoryV11Workbench({ dataSource = 'showcase' })` is the final Phase 1/2 workbench shell.
- Cards: `book-list`, `book-workbench`, `preview`, `batch-tools`; additional fixed cards: `status-center`, `current-filter`.

- [ ] Step 1: Write source-level tests requiring the six approved regions, edit/save/reset layout controls, no legacy API imports, and one preview player marker.
- [ ] Step 2: Verify RED.
- [ ] Step 3: Implement the final workbench frame using native CSS Grid and pointer events, with local showcase state for selected book/video and layout editing.
- [ ] Step 4: Verify source tests PASS and inspect imports against V78 package dependencies.
- [ ] Step 5: Commit `feat(batch-v11): build final V78 workbench frame`.

### Task 3: Status Center, Current Filter, and Unified Player

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/StatusCenter.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/UnifiedPreview.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/workbench-source.test.js`

**Interfaces:**
- Status selection updates `activeStatus` and only changes the separate Current Filter list.
- Preview selection uses one `previewSelection` value: `merged` or VIDEO id.

- [ ] Step 1: Add failing tests for separate current-filter region and single-player switching.
- [ ] Step 2: Verify RED.
- [ ] Step 3: Implement status buttons, exception emphasis, current-filter list, and one unified player surface.
- [ ] Step 4: Verify PASS.
- [ ] Step 5: Commit `feat(batch-v11): add status filter and unified preview`.

### Task 4: Production and Publish Unified Settings

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/ProductionUnifiedSettingsDrawer.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/PublishUnifiedSettingsDrawer.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/InlineConstraintEditor.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/settings-source.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`

**Interfaces:**
- Production Drawer consumes and returns local `batchSettings` in Phase 1; Phase 2 swaps save handler only.
- Drawer order is Config Version -> Basic -> Constraints.

- [ ] Step 1: Write failing tests for Drawer width class, section order, fixed single VIDEO, model/aspect/mode controls, version sync UI, and inline constraint expansion.
- [ ] Step 2: Verify RED.
- [ ] Step 3: Implement final production Drawer and publish Drawer with V78 AntD controls only.
- [ ] Step 4: Verify PASS.
- [ ] Step 5: Commit `feat(batch-v11): add final unified settings drawers`.

### Task 5: Book and VIDEO Settings

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/BookSettingsPopover.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/VideoSettingsDrawer.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/settings-source.test.js`

**Interfaces:**
- Book UI shows override count, config version, constraints, restore inheritance.
- VIDEO UI exposes highest-priority overrides plus asset refs and restore inheritance.

- [ ] Step 1: Add failing tests for inheritance labels, restore controls, and VIDEO-specific settings.
- [ ] Step 2: Verify RED.
- [ ] Step 3: Implement Book compact settings surface and VIDEO settings Drawer using shared InlineConstraintEditor.
- [ ] Step 4: Verify PASS.
- [ ] Step 5: Commit `feat(batch-v11): add book and video override UI`.

### Task 6: V78 Route Integration and Phase 1 Verification

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`
- Modify only if required: `frontend/src/user/App.jsx`
- Modify: `frontend/src/user/pages/batch-factory-workbench.css` only for V78 shell compatibility; V11-specific styles remain in `batch-factory-v11.css`.
- Create: `frontend/src/user/pages/batch-factory-v11/v78-integration-source.test.js`

**Interfaces:**
- `/batch-factory` renders `BatchFactoryV11Workbench` in V78 `UserLayout`.
- `/batch-factory-preview` remains the historical fallback/reference route.

- [ ] Step 1: Write failing test asserting `BatchFactoryPage.jsx` renders V11 workbench and no legacy request module is reachable before the return path.
- [ ] Step 2: Verify RED.
- [ ] Step 3: Replace the early `BatchFactoryPreviewPage` return with the V11 workbench import/render; do not delete historical code in this phase unless needed for Vite parse/build compatibility.
- [ ] Step 4: Run all `node --test frontend/src/user/pages/batch-factory-v11/*.test.js` tests.
- [ ] Step 5: Run `npm run build` from `frontend`; V78 build must pass with zero new dependency requirements.
- [ ] Step 6: Commit `feat(batch-v11): route V78 batch factory to final UI`.

## Phase 1 Acceptance

The user can open the final Batch Factory UI in the V78 application and review layout before Phase 2. All approved regions exist, layout editing is real, Production Unified Settings opens and is fully interactive locally, Book/VIDEO settings open, Status Center filters into Current Filter, only one player exists, and no Phase 1 interaction calls legacy Batch APIs, Go V11 APIs, providers, uploads, or 121.
