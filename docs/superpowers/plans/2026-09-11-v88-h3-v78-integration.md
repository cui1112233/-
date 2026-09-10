# V88 H3 and V78 Capability Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the verified H3 reference-video workflow into the currently published V88 baseline while retaining team video-generation authorization and V78 compatibility.

**Architecture:** V88 remains the public application baseline and owns the release image. H3 transport, reference-image selection, entity image generation, and script-video routing are brought in from the V88 H3 candidate branch, with V78 compatibility routes retained where the candidate already depends on them. Public deployment uses a new immutable image tag and keeps existing MySQL, object storage, and formal volumes unchanged.

**Tech Stack:** Node.js, React/Vite, Express routes, MySQL-backed stores, Docker Compose, ECS, Node test runner.

## Global Constraints

- Preserve the current V88 team video permission scope and manager controls.
- Do not delete or recreate formal MySQL/data volumes.
- Do not enable or create `.github/workflows`; build and deploy outside GitHub Actions.
- Do not print API keys, cookies, passwords, or private-key contents.
- Do not claim completion from build/health alone; verify the target image, served bundle, public routes, and authenticated behavior where credentials are available.

### Task 1: Merge the V88 H3 candidate into the current V88 release baseline

**Files:**
- Modify: Git history and the existing candidate worktree; no formal data files
- Reference: `origin/integration/v88-h3-on-current-v88-20260909-r3`
- Reference: `origin/master`

**Interfaces:**
- Consumes: current `origin/master` containing team video authorization
- Produces: a reviewable combined commit/image source containing H3 and team authorization

- [ ] **Step 1: Record the exact input tips and clean candidate status.**

Run: `git status --short --branch && git rev-parse origin/master origin/integration/v88-h3-on-current-v88-20260909-r3`

Expected: clean candidate and two immutable input SHAs.

- [ ] **Step 2: Merge the H3 candidate into the V88 candidate without touching runtime data.**

Run: `git merge --no-ff origin/integration/v88-h3-on-current-v88-20260909-r3 -m "merge: integrate H3 workflow into V88 release"`

Expected: merge either completes or reports explicit conflicts; no Docker or ECS state changes occur.

- [ ] **Step 3: Resolve conflicts by preserving V88 team authorization and H3 contracts.**

Verify with: `git grep -n "video" frontend/src/user/pages/TeamPage.jsx routes/team-admin.js lib/api-access.js routes/script-video.js`

Expected: team video scope/enforcement remains present, H3 adapter/reference routes remain present, and no `.github/workflows` path is introduced.

### Task 2: Verify the combined contracts before building

**Files:**
- Test: existing H3, team permission, and regression tests
- Inspect: `lib/h3-video-adapter.js`, `routes/script-video.js`, `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/components/ShotOutputCards.jsx`

- [ ] **Step 1: Run focused H3 and team-permission tests.**

Run: `NODE_PATH=/Users/ming/Downloads/qiantie/.worktrees/v88-mainline/node_modules node --test tests/*h3*.test.js tests/*team*.test.js frontend/src/user/pages/scriptEntityImages.test.js`

Expected: all selected tests pass.

- [ ] **Step 2: Run the complete Node regression suite.**

Run: `NODE_PATH=/Users/ming/Downloads/qiantie/.worktrees/v88-mainline/node_modules node --test tests/*.test.js lib/*.test.js routes/*.test.js`

Expected: zero failures; record the exact count.

- [ ] **Step 3: Build the frontend and inspect the generated bundle.**

Run: `npm run build`

Then verify: `rg -n "参考图|mainImageUrl|scriptVideoReferences|H3|reference-assets" frontend/dist`

Expected: build succeeds and the generated bundle contains the H3/reference-image behavior.

### Task 3: Build and stage one combined ECS image

**Files:**
- Modify: candidate Docker build output and ECS staging metadata only
- Preserve: `/opt/qiantie/v88/deploy/v88-public/.env`, MySQL volumes, and existing rollback image

- [ ] **Step 1: Build an immutable amd64 image tagged with both feature identities.**

Run: `docker build --platform linux/amd64 -t qiantie-v88-node-public-v88:h3-team-<commit> .`

Expected: image builds from the merged source without GitHub Actions.

- [ ] **Step 2: Inspect image contents and digest.**

Verify: image architecture, digest, and presence of H3 adapter/reference routes plus team permission code.

Expected: one amd64 image with both feature sets.

- [ ] **Step 3: Transfer and start only the staged candidate service.**

Expected: existing public services remain available until staged service checks pass; no formal volume deletion or `down -v`.

### Task 4: Public verification and controlled cutover

- [ ] **Step 1: Verify target ECS container image and restart count.**

Expected: running V88 Node container uses the new combined image tag and has not entered a restart loop.

- [ ] **Step 2: Verify served `/script` bundle and H3 endpoints.**

Expected: public bundle contains the H3 UI/contract, reference-asset routes respond according to authentication state, and ordinary public routes remain available.

- [ ] **Step 3: Verify authenticated same-account behavior when the user is logged in.**

Check: edit character/scene, generate or upload image, select the main image, see the name tile in the shot card, and submit an H3 video with/without references.

Expected: no-image workflow remains available; reference workflow includes only enabled selected images.

- [ ] **Step 4: Record the final image digest, public bundle marker, and rollback tag.**

Expected: release is reported only with target-image and public-behavior evidence.
