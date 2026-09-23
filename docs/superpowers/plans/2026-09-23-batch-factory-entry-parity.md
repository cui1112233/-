# Batch Factory Entry Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `/batch-factory` entry open the same shared workbench state as `/shuihuo-production`, while retaining the novel-fetch intake handoff.

**Architecture:** Both paths already import `ShuihuoProductionPage`; remove only the route-specific `openBatchOnLoad` wrapper that forces the create dialog. Novel-fetch handoff remains query-driven in `ShuihuoProductionPage` and is not coupled to that wrapper.

**Tech Stack:** React, Vite, Node built-in test runner.

## Global Constraints

- Maintain `v88` as the source of truth; do not mutate production-only files.
- Keep `/novel-fetch` intake handoff behavior intact.
- Do not copy account data, books, assets, or configurations between environments.

---

### Task 1: Use one shared workbench entry state

**Files:**
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/user/pages/新·批量工厂/preview-route.test.js`

**Interfaces:**
- Consumes: `ShuihuoProductionPage` without props.
- Produces: `/batch-factory` and `/shuihuo-production` both resolve to the same page component and initial project-list state.

- [x] **Step 1: Write the failing test**

```js
assert.match(app, /'\/batch-factory': ShuihuoProductionPage/);
assert.doesNotMatch(app, /BatchFactoryFromShuihuoPage/);
assert.doesNotMatch(app, /openBatchOnLoad/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test 'src/user/pages/新·批量工厂/preview-route.test.js'`

Expected: FAIL because the batch route still uses the modal-opening wrapper.

- [x] **Step 3: Write minimal implementation**

```jsx
// Remove BatchFactoryFromShuihuoPage.
'/batch-factory': ShuihuoProductionPage,
```

- [x] **Step 4: Run tests and build**

Run: `node --test 'src/user/pages/新·批量工厂/preview-route.test.js' && npm run --prefix frontend build`

Expected: route test and frontend build pass.

- [x] **Step 5: Commit**

```bash
git add frontend/src/user/App.jsx frontend/src/user/pages/新·批量工厂/preview-route.test.js docs/superpowers/plans/2026-09-23-batch-factory-entry-parity.md
git commit -m "fix(batch-factory): unify public workbench entry"
```
