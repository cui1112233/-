# Stacky 前贴形象 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the original Codex Stacky sprite as the persistent qiantie visual identity and reflect active generation results.

**Architecture:** A small shared module owns the public pet states and atlas rows. React pages dispatch pet state events to a layout-owned `StackyPet` component. The legacy Agent page uses the same event name and atlas values through `public/js/common.js`.

**Tech Stack:** React 18, Vite, plain browser CustomEvent, CSS sprite atlas, Node built-in test runner.

---

### Task 1: Lock the atlas and event contract

**Files:**
- Create: `frontend/src/shared/pet/stacky.test.js`
- Create: `frontend/src/shared/pet/stacky.js`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { PET_EVENT, PET_STATES, petAtlasRow, normalizePetState } from './stacky.js';

test('maps public pet states to original Stacky atlas rows', () => {
  assert.equal(PET_EVENT, 'qiantie:pet-state');
  assert.deepEqual(PET_STATES, ['idle', 'working', 'success', 'error']);
  assert.equal(petAtlasRow('idle'), 0);
  assert.equal(petAtlasRow('working'), 7);
  assert.equal(petAtlasRow('success'), 3);
  assert.equal(petAtlasRow('error'), 5);
  assert.equal(normalizePetState('unknown'), 'idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/shared/pet/stacky.test.js`

Expected: FAIL because `stacky.js` does not exist.

- [ ] **Step 3: Write the minimal atlas module**

```js
export const PET_EVENT = 'qiantie:pet-state';
export const PET_STATES = ['idle', 'working', 'success', 'error'];

const atlasRows = { idle: 0, working: 7, success: 3, error: 5 };

export function normalizePetState(state) {
  return PET_STATES.includes(state) ? state : 'idle';
}

export function petAtlasRow(state) {
  return atlasRows[normalizePetState(state)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/shared/pet/stacky.test.js`

Expected: PASS with one passing test.

### Task 2: Render Stacky in React work pages

**Files:**
- Create: `frontend/src/shared/pet/StackyPet.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/styles/global.css`

- [ ] **Step 1: Add the visual component**

Create `StackyPet` with a state-event listener, a 2.4-second success/error reset, fixed `aria-label`, and atlas-row CSS variable.

- [ ] **Step 2: Mount it from the authenticated layout**

Render `<StackyPet />` only when `isLoggedIn && !isHome`.

- [ ] **Step 3: Add responsive, pointer-transparent sprite CSS**

Use `position: fixed`, `right: 22px`, `bottom: 18px`, 120x130 CSS cells, `background-size: 800% 1100%`, 8-step animation, and smaller cells below 640px.

- [ ] **Step 4: Build the React frontend**

Run: `npm --prefix frontend run build`

Expected: exit code 0.

### Task 3: Connect generation outcomes and the legacy Agent page

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/TtsPage.jsx`
- Modify: `public/js/common.js`
- Modify: `public/css/style.css`

- [ ] **Step 1: Dispatch generation states from React pages**

Call `dispatchPetState('working')` before each request, `dispatchPetState('success')` after success, and `dispatchPetState('error')` in error handlers.

- [ ] **Step 2: Inject a legacy Agent pet**

On page load, append a pointer-transparent Stacky container to `document.body`; listen for `qiantie:pet-state`; default to the idle row.

- [ ] **Step 3: Verify source and runtime responses**

Run: `node --test frontend/src/shared/pet/stacky.test.js && npm --prefix frontend run build && curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3000/settings && curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3000/pets/stacky/spritesheet.webp`

Expected: test passes, build exits 0, and both endpoints return `200`.
