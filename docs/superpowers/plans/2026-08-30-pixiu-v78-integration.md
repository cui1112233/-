# Pixiu V78 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CM/Pixiu selection and persistence to the restored V78 application while preserving every V78 route and keeping Node.js and Go services coexisting.

**Architecture:** Use the V78 Node platform as the owner of user configuration and canonical pet definitions. Reuse the full V78 React source to rebuild the tracked frontend bundle, then adapt only the settings and companion components; the existing Go backend remains an independent service.

**Tech Stack:** Node.js 24, Express, React 18, Vite, existing Go backend, Docker Compose.

## Global Constraints

- The production V78 snapshot is the baseline; the old Pixiu merge is not a release baseline.
- Legacy or missing pet values resolve to `stacky`/CM.
- The client submits only a pet ID; the server stores a canonical pet object.
- Do not commit runtime data, `.env`, local compose overrides, or lockfile noise.
- Do not start full Go migration or publish Docker until build and V78 route smoke checks pass.

### Task 1: Reconstruct a source-backed V78 candidate

**Files:**
- Create: `frontend/src/**` and frontend build metadata from the verified V78 source worktree.
- Modify: `frontend/dist/**` through the Vite production build.

- [ ] Copy only source/build inputs from `ee8eb9f` into this isolated candidate.
- [ ] Run `npm install` and `npm run frontend:build`.
- [ ] Verify the server still exposes all V78 deep-link routes and existing static assets.

### Task 2: Define the Node pet contract with tests first

**Files:**
- Create: `lib/pet-catalog.js`
- Modify: `lib/shared.js`, `routes/config.js`
- Test: `lib/pet-catalog.test.js`, `routes/config.test.js`

- [ ] Add failing tests for legacy default, valid Pixiu, invalid fallback, and field preservation.
- [ ] Implement catalog normalization and use it in GET/POST `/api/config`.
- [ ] Run focused tests, then the existing Node suite.

### Task 3: Add Pixiu to the V78 companion UI

**Files:**
- Create: `pets/pixiu/pet.json`, `pets/pixiu/spritesheet.webp`, `frontend/src/shared/pet/petCatalog.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`, `frontend/src/shared/pet/CmPenguinCompanion.jsx`, `frontend/src/shared/layouts/UserLayout.jsx`
- Test: focused catalog/selection tests

- [ ] Add CM and Pixiu options while keeping CM as default.
- [ ] Render the selected sprite and preserve overlay, chat, task, and animation state across selection changes.
- [ ] Verify the browser requests only `/pets/pixiu/spritesheet.webp` and submits the ID.

### Task 4: Gate and package without publishing

**Files:**
- Modify only necessary tracked source/build files.

- [ ] Run frontend build, Node tests, Go tests, and Pixiu focused tests.
- [ ] Compare V78 route/API smoke results against the production snapshot.
- [ ] Inspect `git status` and exclude runtime/deployment files.
- [ ] Create a focused commit; leave Docker production unchanged pending explicit release gate.
