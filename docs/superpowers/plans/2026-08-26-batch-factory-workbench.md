# Batch Factory Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Reorganize batch factory into a Shuihuo-adjacent four-zone workbench matching the supplied reference image while preserving existing APIs and batch behavior.

**Architecture:** Keep the existing BatchFactoryPage data flow and child production components, add a presentational workbench shell with derived status/list/progress data, and move the current expanded item details into the center pane. Add only focused CSS and navigation changes.

**Tech Stack:** React, Ant Design, Lucide, existing user theme CSS, Node test contracts, Vite.

## Global Constraints

- Preserve `/batch-factory` and all existing batch-factory API calls.
- Do not modify account center, team authorization, model service, or batch data files.
- Do not add frontend dependencies.
- Keep desktop four-zone layout and responsive stacked fallback.

### Task 1: Add failing UI contracts

**Files:**
- Create: `tests/batch-factory-workbench-ui.test.js`

- [ ] **Step 1: Write failing structural contracts**

Assert that the page source contains `batch-factory-workbench`, the status center labels, the novel list, the progress/merge rail, and the Shuihuo navigation adjacency.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/batch-factory-workbench-ui.test.js`
Expected: FAIL because the new workbench markers do not exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/batch-factory-workbench-ui.test.js
git commit -m "test: define batch factory workbench contract"
```

### Task 2: Add workbench layout and navigation

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Create: `frontend/src/user/pages/batch-factory-workbench.css`

- [ ] **Step 1: Derive workbench view data**

Add pure helpers in `BatchFactoryPage.jsx` for status counts, status labels, filtered/sorted items, and video progress. Keep existing `activeBatch`, `setActiveBatch`, and API handlers as the source of truth.

- [ ] **Step 2: Render the four-zone shell**

Render classes `batch-factory-workbench`, `batch-factory-topbar`, `batch-factory-status-center`, `batch-factory-novel-list`, `batch-factory-center`, and `batch-factory-right-rail`. Keep the no-batch import/setup screen; render the shell only when `activeBatch` exists.

- [ ] **Step 3: Move single-book details into the center pane**

Track `selectedItemId` and `statusFilter` locally. Selecting a novel updates only the center detail. Reuse existing hook review, director detail, production controls, activity log, and compile modal handlers.

- [ ] **Step 4: Add progress and merge rail**

Reuse `BatchFactoryBatchProductionStatus` for current batch progress and merge actions, placing it inside a collapsible right rail with a compact summary above it. Do not duplicate merge API calls.

- [ ] **Step 5: Add adjacent Shuihuo navigation entry**

Update the user navigation label/group so Shuihuo production and batch factory appear as adjacent creation tools; keep direct URL compatibility and existing permission behavior.

- [ ] **Step 6: Add responsive/theme CSS**

Use existing `--legacy-*`/theme tokens, fixed grid tracks, readable dark/light colors, and a breakpoint that stacks or collapses the rails without page-level horizontal overflow.

- [ ] **Step 7: Run focused tests and build**

Run: `node --test tests/batch-factory-workbench-ui.test.js test/batch-factory.test.js tests/batch-factory-current-mainline-contract.test.js`
Run: `npm --prefix frontend run build`
Expected: all tests pass and Vite build succeeds with only existing warnings.

### Task 3: Visual/interaction verification

**Files:**
- Modify: `tests/batch-factory-workbench-ui.test.js` if a discovered contract needs tightening.

- [ ] **Step 1: Start/rebuild test Docker**

Run: `bash ./scripts/build-test-docker-artifacts.sh && COMPOSE_PROJECT_NAME=deploy docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml up --build -d`

- [ ] **Step 2: Verify health and route**

Run: `COMPOSE_PROJECT_NAME=deploy bash ./scripts/deploy-test-docker.sh health`
Run: `curl -fsS -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1:3000/batch-factory`

- [ ] **Step 3: Run the full relevant Node suite**

Run: `node --test test/batch-factory.test.js tests/batch-factory-current-mainline-contract.test.js tests/batch-factory-workbench-ui.test.js tests/account-center-governance-contract.test.js tests/account-center-visual-contract.test.js`

- [ ] **Step 4: Review diff and commit**

```bash
git diff --check
git status --short
git add frontend/src/user/pages/BatchFactoryPage.jsx frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx frontend/src/shared/layouts/UserLayout.jsx frontend/src/user/pages/shuihuo-production.css frontend/src/user/pages/batch-factory-workbench.css tests/batch-factory-workbench-ui.test.js docs/superpowers/specs/2026-08-26-batch-factory-workbench-design.md docs/superpowers/plans/2026-08-26-batch-factory-workbench.md
git commit -m "feat: reshape batch factory into workbench"
```
