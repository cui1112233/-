# Batch Factory Screenshot Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the active batch-factory workbench to match the supplied screenshot while keeping creation flow, existing APIs, and theme switching intact.

**Architecture:** Keep `BatchFactoryPage` as the orchestration layer and reuse existing production, prompt, and merge components. Add screenshot-specific regions and semantic CSS classes around the existing handlers, with all visual values derived from theme variables or Ant Design tokens.

**Tech Stack:** React 18, Ant Design 5, Lucide icons, Vite, Node test runner, Docker Compose.

## Global Constraints

- The change applies only after a batch is opened; the draft/create page keeps its current behavior.
- “返回水货生产” navigates to `/shuihuo-production` without deleting or resetting batch data.
- Colors must work in both dark and light themes; do not hard-code dark-only text colors.
- Existing backend APIs and handlers remain the source of truth; unsupported screenshot actions must be disabled or clearly labeled.

### Task 1: Add screenshot workbench contract tests

**Files:**
- Modify: `tests/batch-factory-workbench-ui.test.js`
- Test target: rendered source contract strings for `BatchFactoryPage.jsx` and CSS classes.

- [ ] Add assertions for page title, back button, batch action bar, production/publish tabs, abnormal summary, three-column regions, video progress ring, and bulk merge section.
- [ ] Run `node --test tests/batch-factory-workbench-ui.test.js` and verify the new assertions fail against the current structure.
- [ ] Commit the test-only change with `test: cover screenshot batch factory regions`.

### Task 2: Rebuild active batch shell markup

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`

- [ ] Add `ArrowLeft` import and a `returnToShuihuoProduction` handler using `window.history.pushState` plus `PopStateEvent`, matching existing SPA navigation.
- [ ] Add a title header with `批量工厂`, explanatory copy, back button, and new-batch action.
- [ ] Add a batch summary row with batch name, count, edit affordance, production/publish tabs, and action buttons mapped to current handlers; disable publish/upload actions when no handler exists.
- [ ] Add an abnormal-items summary beside the status counters; clicking an item selects it and sets the failed filter.
- [ ] Preserve existing left, center, and right content, but wrap them in semantic screenshot classes required by the contract test.
- [ ] Run the focused contract test and fix only the missing structural assertions.

### Task 3: Match screenshot layout and theme behavior

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-workbench.css`

- [ ] Define theme-safe variables using existing legacy/Ant tokens with light-theme fallbacks for background, panel, text, muted text, border, accent, and semantic status colors.
- [ ] Style the page header, batch action bar, compact action buttons, status center with abnormal summary, and three-column workbench to match the screenshot proportions.
- [ ] Add styles for the central error card, foldable section rows, right-side progress ring container, activity note, and merge controls.
- [ ] Keep the existing responsive breakpoints, moving right rail below center at medium widths and stacking all regions on mobile.
- [ ] Run `npm run build` from `frontend/` and inspect both theme class branches for readable text and no overflow.

### Task 4: Verify and package

**Files:**
- No source changes unless verification exposes a focused defect.

- [ ] Run `node --test tests/batch-factory-workbench-ui.test.js` and the related batch-factory tests.
- [ ] Rebuild `frontend` and the platform Docker image with `deploy/.env.test-docker` loaded.
- [ ] Restart the test Compose stack and verify platform/backend containers are healthy.
- [ ] Reload `/batch-factory` in the signed-in browser and verify the title/back button, action bar, status center, three columns, and right rail are visible.
- [ ] Commit implementation and verification changes without staging unrelated user modifications.
