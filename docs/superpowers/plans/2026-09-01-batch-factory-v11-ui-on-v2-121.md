# Batch Factory V11 UI Overlay on Novel Fetch V2/121 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with a verification checkpoint after every task.

**Goal:** Make `/batch-factory` in the Novel Fetch V2/121 candidate render the verified V11 Batch Factory workbench UI from `fd45ed4`, while preserving the V2/121 backend and all existing rollback assets.

**Architecture:** Start from `b3605e00580be7f1003196b64dff94dffcde5eca`. Selectively copy only the V11 React page modules, their scoped CSS/state helpers, and the V11 API adapter from `fd45ed433479b7724098cf08e93a21565b3b64e2`. Change the `/batch-factory` page entry to `BatchFactoryV11UiPage`; leave the old preview route available as a rollback/debug route. Do not copy `app.js`, Node routes, Go code, stores, migrations, or legacy Batch Factory APIs from `fd45ed4`.

**Tech Stack:** React, Ant Design, lucide-react, Vite, Node test runner, Docker Compose.

## Global Constraints

- Base commit remains `b3605e00580be7f1003196b64dff94dffcde5eca` and the original V2/121 branch remains untouched.
- Source UI provenance is fixed to `fd45ed433479b7724098cf08e93a21565b3b64e2`; no whole-branch merge.
- No new Node or Go Batch Factory business rules; no legacy `/api/batch-factory/*` calls from V11 UI files.
- `/batch-factory` is a UI replacement only in this slice. V11 saves remain local UI state until a real V11 backend exists; unwired production, merge, 121, and Yadi actions stay disabled.
- Do not change `master`, production `:3000`, production MySQL, production volumes, or the existing V2/121 review Compose.
- Keep the old `BatchFactoryPreviewPage` and old image available for rollback.

### Task 1: Add UI overlay contract and provenance tests

**Files:**
- Create: `tests/batch-factory-v11-ui-overlay.test.js`
- Test: `frontend/src/user/pages/batch-factory-v11/*.test.js`

**Interfaces:**
- The root contract test reads `frontend/src/user/pages/BatchFactoryPage.jsx` and the copied V11 directory.
- It must assert the route imports/renders `BatchFactoryV11UiPage`, does not render `BatchFactoryPreviewPage`, and that production V11 files contain neither legacy `/api/batch-factory/` endpoints nor imports of `batchFactory.js`.

- [ ] **Step 1: Write the failing route contract test**

```js
const source = fs.readFileSync(path.join(root, 'frontend/src/user/pages/BatchFactoryPage.jsx'), 'utf8');
assert.match(source, /BatchFactoryV11UiPage/);
assert.doesNotMatch(source, /BatchFactoryPreviewPage/);
```

- [ ] **Step 2: Run the focused test and verify it fails on the current preview entry**

Run: `node --test tests/batch-factory-v11-ui-overlay.test.js`

Expected: FAIL because the current entry returns `BatchFactoryPreviewPage` and the V11 directory is absent.

- [ ] **Step 3: Add the remaining source guards**

The test must recursively inspect non-test `.js/.jsx` files under `frontend/src/user/pages/batch-factory-v11` and assert that `/api/batch-factory/` is absent unless the path is explicitly `/api/batch-factory/v11`. It must also assert that `frontend/src/shared/api/batchFactoryV11.js` exists.

- [ ] **Step 4: Commit the test-only checkpoint**

```bash
git add tests/batch-factory-v11-ui-overlay.test.js
git commit -m "test(batch-factory): define v11 ui overlay boundary"
```

### Task 2: Selectively overlay the V11 workbench UI

**Files:**
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ConstraintEditor.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11PublishSettings.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ScopedSettings.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/WorkbenchCard.jsx`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/batchFactoryV11State.js`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js`
- Create from `fd45ed4`: `frontend/src/user/pages/batch-factory-v11/showcaseData.js`
- Create from `fd45ed4`: all six `batch-factory-v11-*.css` files and their focused source tests
- Create from `fd45ed4`: `frontend/src/shared/api/batchFactoryV11.js` and `frontend/src/shared/api/batchFactoryV11.test.js`
- Modify: `frontend/src/user/pages/BatchFactoryPage.jsx`

**Interfaces:**
- `BatchFactoryPage` exports the V11 page as the `/batch-factory` route component.
- `BatchFactoryV11UiPage` preserves its existing disabled-action semantics and local UI-state notices.
- `BatchFactoryPreviewPage` remains reachable only from `/batch-factory-preview`; no V11 module imports it.

- [ ] **Step 1: Copy only the listed blobs and verify each blob SHA**

Run: `git show fd45ed4:<path>` for every listed path and compare `git hash-object` in the new worktree with `git rev-parse fd45ed4:<path>`.

- [ ] **Step 2: Change the page entry to V11**

`frontend/src/user/pages/BatchFactoryPage.jsx` must contain only the V11 import/export wrapper and must not import the old preview page.

- [ ] **Step 3: Run focused V11 and root contract tests**

Run: `node --test tests/batch-factory-v11-ui-overlay.test.js frontend/src/shared/api/batchFactoryV11.test.js frontend/src/user/pages/batch-factory-v11/*.test.js`

Expected: all focused tests pass, with no calls to legacy Batch Factory APIs.

- [ ] **Step 4: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: Vite exits 0 and emits the V11 page chunk; existing V2/121 assets remain present.

- [ ] **Step 5: Commit the selective overlay**

```bash
git add frontend/src/user/pages/BatchFactoryPage.jsx frontend/src/user/pages/batch-factory-v11 frontend/src/shared/api/batchFactoryV11.js frontend/src/shared/api/batchFactoryV11.test.js
git commit -m "feat(batch-factory): make v11 workbench the candidate entry"
```

### Task 3: Build and validate a combined temporary candidate

**Files:**
- Modify only generated `frontend/dist` as required by the image build; do not commit generated output unless this repository convention requires it.
- Use existing: `docker-compose.novel-fetch-v2-review.yml`

**Interfaces:**
- Candidate keeps the existing V2/121 Platform and private Worker services.
- Candidate is exposed only at `127.0.0.1:13107` with a fresh temporary data directory.

- [ ] **Step 1: Re-run the complete source checks**

Run: `node --test tests/*.test.js`, `npm --prefix services/121-browser-worker test`, and `npm --prefix frontend run build`.

- [ ] **Step 2: Build a uniquely tagged Platform image**

Run: `docker build -t qiantie-platform:bf11-ui-on-v2-121-<sha> -f Dockerfile .`.

- [ ] **Step 3: Start the existing review Compose with the new Platform image and existing tested Worker image**

Use only temporary `/tmp` data directories and the private Worker network; never use the production data mount.

- [ ] **Step 4: Smoke the combined candidate**

Check `/`, `/novel-fetch`, `/batch-factory`, `/batch-factory-preview`, and `/api/login/session`. On `/batch-factory`, verify the V11 marker, novel selection, status filters, Drawer opening, layout save/reset, and disabled unwired actions. Confirm the V2/121 Worker remains healthy and host port 8787 remains closed.

- [ ] **Step 5: Record image digest, container state, and rollback command; do not switch `:3000`**

Rollback is stopping/removing only the temporary Compose and restarting the prior `qiantie-platform:novel-fetch-v2-121-hardening-b3605e0-review` candidate with the same temporary data directory.

## Verification and Stop Conditions

- Stop immediately if any V2/121 test regresses, if a V11 module imports legacy Batch Factory APIs, or if the candidate requires production data.
- Report separately which UI interactions are local showcase state and which have a real backend; do not call the UI fully functional until V11 APIs and persistence are implemented.
