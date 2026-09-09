# H3 Shot Reference Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit character/scene main-image selection and per-shot H3 reference-image controls to the script page, preserving the existing unified H3 entry, asynchronous task contract, and `ref_image_0..8` mapping.

**Architecture:** Keep entity media state on each normalized character/scene record as `imageUrls` plus explicitly selected `mainImageUrl`; never infer a main image from array order. Add a pure reference-image helper that matches only entities named in the current shot, orders characters before scenes, de-duplicates URLs, applies the current shot's enabled/disabled state, and caps the result at nine. The script page persists this shot-local state with drafts/history and passes the resulting `imageUrls` only for H3 requests; the existing server H3 adapter continues to choose text/image workflow and map the URLs.

**Tech Stack:** React/Ant Design/Vite, Node.js built-in test runner, existing Express H3 route and unified video catalog.

**Spec:** Confirmed H3 development plan in the referenced `H3开发` conversation; related existing design: `docs/superpowers/specs/2026-09-08-unified-video-model-catalog-h3-design.md`.

## Global Constraints

- Work only on `feat/v88-h3-unified-video-20260909`; do not modify `master`, the `v88` branch, V78, production, ECS, the public site, 121, batch factory behavior, or credentials.
- The requested baseline `d1e163852a9825448b0b6eb86bfba04adcd224b6` is not present in the available clones; the recovered local H3 snapshot is recorded at `28d23650` and this discrepancy must remain explicit in the final report.
- A main image changes only after an explicit user action; image array order, latest generated image, or first image must never select it automatically.
- Shot reference state is local to a shot. Turning one shot off sends `imageUrls: []` for that shot and cannot clear or mutate any entity's `mainImageUrl` or another shot's state.
- H3 receives at most nine HTTPS image URLs in character-first, scene-second order with duplicate URLs removed; zero selected URLs remain an empty array so the existing H3 route chooses its no-image workflow.
- Do not read, print, store, or add any API key, token, cookie, password, or other credential.

---

### Task 1: Reference-image domain helper and RED tests

**Files:**
- Create: `frontend/src/user/pages/scriptVideoReferences.js`
- Test: `frontend/src/user/pages/scriptVideoReferences.test.js`

**Interfaces:**
- `getEntityMedia(entity)` returns `{ imageUrls: string[], mainImageUrl: string }` and never falls back from `mainImageUrl` to `imageUrls[0]`.
- `setEntityMainImage(extractInfo, type, entityId, imageUrl)` returns a new extract-info value with only the selected entity's main image changed.
- `collectShotReferenceImages({ shotText, extractInfo, shotIndex, shotReferenceStates })` returns at most nine URLs.
- `toggleShotReferenceState(states, shotIndex, patch)` returns a new state map keyed by shot index.

- [ ] **Step 1: Write failing tests**

  Cover: no implicit first-image selection; explicit main-image selection; shot 0 off does not change shot 1 or entity state; unrelated entities are excluded; characters precede scenes; duplicate URLs collapse; more than nine URLs are truncated; disabled shot returns `[]`.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

  Expected: module/export failures because the helper does not exist yet.

### Task 2: Minimal helper implementation

**Files:**
- Modify: `frontend/src/user/pages/scriptVideoReferences.js`
- Modify: `frontend/src/user/pages/scriptEntities.js` only if normalization must preserve media metadata

- [ ] **Step 1: Implement only the contracts from Task 1**

  Preserve entity records immutably, match names against the current shot text, keep character order before scene order, de-duplicate by normalized URL, cap at nine, and treat missing/disabled shot state as no selected URLs only when the shot is explicitly disabled.

- [ ] **Step 2: Run the focused test and confirm GREEN**

  Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js`

  Expected: all helper tests pass.

### Task 3: Script-page wiring and user-visible controls

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/shared/styles/global.css` only for the new compact controls

- [ ] **Step 1: Add explicit entity main-image controls**

  Show existing candidate image URLs in the character/scene editor, provide an explicit `设为主图` action, show the selected main-image state, and preserve media metadata when editing an entity. Adding a candidate URL must not select it automatically.

- [ ] **Step 2: Add shot-local reference controls**

  Pass each shot's reference descriptors and state into `ShotOutputCards`; render `参考图：亮/灭` and image chips for the current shot. Toggling the card updates only the keyed shot state. Do not update `extractInfo` while toggling.

- [ ] **Step 3: Pass H3 references through `createScriptVideo`**

  In `generateVideoForShot`, call `collectShotReferenceImages` for the current card and add `imageUrls` only for `minimax-h3-video`. A disabled shot must pass `imageUrls: []`; an enabled shot with no explicit main images must also pass `[]` and rely on the existing H3 no-image workflow.

- [ ] **Step 4: Preserve state in drafts and script history**

  Save and restore `shotReferenceStates` alongside `extractInfo` and `videoTasks`; do not create a second history system.

### Task 4: GREEN regression and build verification

**Files:**
- No additional production files unless a failing scoped test identifies one.

- [ ] **Step 1: Run helper and existing H3 contracts**

  Run: `node --test frontend/src/user/pages/scriptVideoReferences.test.js tests/h3-video-contract.test.js tests/h3-video-adapter.test.js tests/h3-script-video-route.test.js tests/h3-video-models-route.test.js tests/h3-frontend-catalog-contract.test.js`

- [ ] **Step 2: Run relevant front-end source tests and production build**

  Run the existing front-end Node test command for the changed source contracts, then `npm run frontend:build`; record exit codes and actual pass counts. Do not treat warnings as failures or as deployment proof.

- [ ] **Step 3: Verify scope and diff**

  Check `git diff --check`, inspect `git status --short`, and verify changed paths are limited to the H3/reference-image helper, script page/card/styles, their tests, and the plan. Existing unrelated dirty files must remain untouched.

### Task 5: Commit and completion evidence

- [ ] **Step 1: Commit only the current H3 shot-reference changes**

  Use a focused commit after all fresh verification passes; do not stage unrelated existing dirty files.

- [ ] **Step 2: Re-run completion verification from the committed tree**

  Re-run the exact focused tests, build, `git diff --check`, and status. Report the resulting commit SHA, actual RED failure, GREEN commands/results, user-visible acceptance steps, the unavailable `d1e1638…` baseline caveat, and the fact that real AutoDL external generation remains unverified.
