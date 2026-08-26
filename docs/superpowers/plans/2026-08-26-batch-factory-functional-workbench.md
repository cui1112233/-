# Batch Factory Functional Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/batch-factory` a real three-column video-production workbench beside 水货生产, with no fabricated production or publishing state.

**Architecture:** Keep the existing batch-factory API and its state machine as the source of runtime data. Recompose the current four visual regions into book list, selected-book production detail, and whole-batch monitoring/merge. Keep external publishing visibly unavailable until a verified remote contract exists.

**Tech Stack:** React 18, Ant Design, Vite, Node built-in test runner, existing `/api/batch-factory/*` API, Docker Compose.

## Global Constraints

- Do not modify the dirty primary checkout; work only in this isolated worktree.
- Frontend API URLs remain same-origin relative paths.
- Purple means selection/primary action, red means error only, and generated/progress state always has text.
- Do not report 121 or external upload as successful without a verified per-file remote receipt.
- Do not add JSON/file persistence for new batch state; MySQL migration is required before new backend state.
- Run `npm --prefix frontend run build` and `node --test tests/batch-factory-workbench-ui.test.js` before merging.

---

### Task 1: Lock the executable UI contract and navigation

**Files:**
- Modify: `tests/batch-factory-workbench-ui.test.js`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`

**Interfaces:**
- Consumes: sidebar items using `href`.
- Produces: `/batch-factory` directly after `/shuihuo-production` and contract coverage that no static preview is returned.

- [ ] **Step 1: Write the failing navigation test**

```js
test('batch factory sits directly after water production in global navigation', () => {
  const water = layout.indexOf("href: '/shuihuo-production'");
  const batch = layout.indexOf("href: '/batch-factory'");
  assert.ok(water >= 0 && batch > water);
  assert.ok(batch - water < 320);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/batch-factory-workbench-ui.test.js`
Expected: FAIL because `UserLayout` has no batch-factory item.

- [ ] **Step 3: Add the navigation item immediately after water production**

```js
{ href: '/shuihuo-production', label: '水货生产', icon: Clapperboard },
{ href: '/batch-factory', label: '批量工厂', icon: Factory },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/batch-factory-workbench-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add tests/batch-factory-workbench-ui.test.js frontend/src/shared/layouts/UserLayout.jsx && git commit -m "feat(batch-factory): add workbench navigation"`

### Task 2: Convert four visual regions into the approved three-column workbench

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx:110-860`
- Modify: `frontend/src/user/pages/batch-factory-workbench.css:55-130`
- Modify: `tests/batch-factory-workbench-ui.test.js`

**Interfaces:**
- Consumes: `activeBatch`, `selectedItem`, `BatchFactoryProductionControls`, and `BatchFactoryBulkProduction`.
- Produces: `batch-factory-workbench-grid` with left list, center detail, and right rail; VIDEO actions render inside center detail.

- [ ] **Step 1: Write the failing three-column contract**

```js
assert.doesNotMatch(pageSource, /batch-factory-video-operations[\s\S]*batch-factory-resize-handle[\s\S]*batch-factory-right-rail/);
assert.match(css, /grid-template-columns:\s*var\(--bf-list-width\).*minmax\(0, 1fr\).*var\(--bf-rail-width\)/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/batch-factory-workbench-ui.test.js`
Expected: FAIL because VIDEO operations are a fourth sibling column.

- [ ] **Step 3: Move selected-book VIDEO operations under the center detail and use three persisted widths**

```js
const DEFAULT_COLUMN_SIZES = [280, 760, 340];
const [columnSizes, setColumnSizes] = useState(() => loadColumnSizes(DEFAULT_COLUMN_SIZES));
```

- [ ] **Step 4: Make the action bar a three-area desktop grid and add narrow-screen fallbacks**

```css
.batch-factory-action-bar { grid-template-columns: minmax(260px, .9fr) minmax(340px, 1.15fr) auto; }
.batch-factory-workbench-grid { grid-template-columns: var(--bf-list-width) minmax(0, 1fr) var(--bf-rail-width); }
@media (max-width: 1160px) { .batch-factory-workbench-grid { grid-template-columns: 260px minmax(0, 1fr); } }
```

- [ ] **Step 5: Run UI test and frontend build**

Run: `node --test tests/batch-factory-workbench-ui.test.js && npm --prefix frontend run build`
Expected: PASS and Vite build success.

- [ ] **Step 6: Commit**

Run: `git add frontend/src/user/pages/BatchFactoryPage.jsx frontend/src/user/pages/batch-factory-workbench.css tests/batch-factory-workbench-ui.test.js && git commit -m "feat(batch-factory): align functional workbench layout"`

### Task 3: Make batch state and progress diagnostics truthful

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx:154-180,680-850`
- Modify: `tests/batch-factory-workbench-ui.test.js`

**Interfaces:**
- Consumes: each item’s `status`, `production`, and `directorResult.storyboard`.
- Produces: `deriveBatchFactoryStatus(item)` and `summarizeBatchFactoryVideoProgress(items)`; book and VIDEO counts remain separate.

- [ ] **Step 1: Write failing helper contracts**

```js
assert.match(pageSource, /function deriveBatchFactoryStatus\(item\)/);
assert.match(pageSource, /function summarizeBatchFactoryVideoProgress\(items\)/);
assert.match(pageSource, /item\.productionSubmissionError|item\.error/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/batch-factory-workbench-ui.test.js`
Expected: FAIL because the named helpers do not exist.

- [ ] **Step 3: Implement helpers and use them in the status center and progress ring**

```js
function deriveBatchFactoryStatus(item) {
  if (item?.status === 'failed' || item?.production?.failed || item?.error || item?.productionSubmissionError) return 'failed';
  if (item?.production?.projectId) return item?.production?.completed ? 'merged-ready' : 'video_generating';
  return item?.status || 'pending';
}
```

- [ ] **Step 4: Keep publish visibly unavailable without false state**

```jsx
<Button disabled title="等待 121 发布任务创建与回执接口接通">发布统一设置（待接通）</Button>
```

- [ ] **Step 5: Run focused test and build**

Run: `node --test tests/batch-factory-workbench-ui.test.js && npm --prefix frontend run build`
Expected: PASS and Vite build success.

- [ ] **Step 6: Commit**

Run: `git add frontend/src/user/pages/BatchFactoryPage.jsx tests/batch-factory-workbench-ui.test.js && git commit -m "feat(batch-factory): clarify production progress states"`

### Task 4: Verify release prerequisites and document boundaries

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-batch-factory-functional-workbench-design.md`
- Modify: `docs/superpowers/plans/2026-08-26-batch-factory-functional-workbench.md`

**Interfaces:**
- Consumes: production API responses and the Docker platform.
- Produces: release evidence that distinguishes UI/API health from provider generation or external publishing.

- [ ] **Step 1: Run complete focused verification**

Run: `node --test tests/batch-factory-workbench-ui.test.js && npm --prefix frontend run build`
Expected: PASS.

- [ ] **Step 2: Check compose syntax and platform health without deleting volumes**

Run: `docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml config --quiet && scripts/deploy-test-docker.sh health`
Expected: compose valid and existing health endpoint responds.

- [ ] **Step 3: Record the verified boundary**

```markdown
Verification establishes frontend build and platform/API reachability only. It does not claim successful provider generation or 121 publishing without a concrete task receipt.
```

- [ ] **Step 4: Commit**

Run: `git add docs/superpowers/specs/2026-08-26-batch-factory-functional-workbench-design.md docs/superpowers/plans/2026-08-26-batch-factory-functional-workbench.md && git commit -m "docs(batch-factory): record workbench verification"`

## Deferred, independently gated work

1. **MySQL batch persistence:** replace `lib/batch-factory/store.js` JSON storage after identifying the current MySQL connection and Goose migration owner. Tables need batches, books, setting snapshots, hook reviews, video task receipts and activity logs with authenticated team scoping.
2. **121 publishing:** implement only after capturing a verified remote request/response for task creation, per-file status polling, material parameters and task completion. UI stays disabled until then.

## Self-review

- Tasks 1-3 cover navigation, layout, real production controls and truthful states; Task 4 verifies release prerequisites.
- The plan has no placeholders and every task contains files, commands and expected results.
- MySQL and 121 are explicitly separated because the current source has neither a Goose migration owner nor a verified external publishing contract.

## Execution status

- [x] Task 1: Navigation contract and item completed in commit `da1e6ca`.
- [x] Task 2: Three-column workbench and responsive layout completed in commit `4b772d9`.
- [x] Task 3: Production polling, book status mapping and truthful publish boundary completed in commit `a843d9f`.
- [x] Task 4: UI test, frontend build, Compose validation, backend health and deployed platform reachability verified on 2026-08-26.
