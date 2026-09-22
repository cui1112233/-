# V88 Batch Factory Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the redesigned Batch Factory into the latest V88 branch and publish the exact verified V88 release to the public runtime without touching V78.

**Architecture:** Treat current `v88` as authoritative. Merge only the six unique Batch Factory commits into an isolated integration branch, preserve all newer V88 changes, validate through PR checks, then release paired immutable Node and Go images from one exact SHA and verify the public runtime against that SHA.

**Tech Stack:** Go, React, Ant Design, Node.js, GitHub Actions, Docker/Buildx, GHCR, ECS, MySQL/Goose, Redis, TOS.

**Spec:** `docs/superpowers/specs/2026-09-12-v88-batch-factory-public-release-design.md`

## Global Constraints

- Work from `v88` baseline `fc758bac1573d54e8ba9cdadc941daeac00447cf` or a newer V88 head if V88 moves during execution.
- Source redesign head is `32dae4ab913d703bc6cd523dd0d7569b7ec8db29` and contains six unique Batch Factory commits.
- Never deploy the old feature branch directly.
- Never modify, restart, or use V78 as a rollback target.
- Preserve newer V88 novel-fetch, auth, deployment, and unrelated fixes.
- Public release must use paired immutable Node and Go images from one exact SHA.

---

### Task 1: Isolate the V88 integration

**Files:**
- Create: `docs/superpowers/specs/2026-09-12-v88-batch-factory-public-release-design.md`
- Create: `docs/superpowers/plans/2026-09-12-v88-batch-factory-public-release.md`

**Interfaces:**
- Consumes: current `v88` head and Batch Factory source branch head.
- Produces: `feature/v88-batch-factory-public-release-20260912` based on current V88.

- [ ] **Step 1: Verify the integration branch starts from current V88**

Check the branch parent and compare against `v88`.

- [ ] **Step 2: Commit the release design and implementation plan**

Expected result: documentation commits exist only on the isolated integration branch.

### Task 2: Integrate the six Batch Factory commits

**Files:**
- Modify only paths changed by commits `8e676bde`, `86b67e2d`, `7214c73f`, `e39e8b73`, `473c723d`, `32dae4ab`.

**Interfaces:**
- Consumes: current V88 code plus the six source commits.
- Produces: one integration branch containing both current V88 fixes and redesigned Batch Factory behavior.

- [ ] **Step 1: Open a merge PR from `feature/v88-batch-factory-rebuild-20260912` into the integration branch**

Expected: GitHub computes mergeability against the current V88-derived integration branch.

- [ ] **Step 2: If mergeable, merge with a merge commit**

Preserve the six source commits and integration history. Do not squash away provenance.

- [ ] **Step 3: If conflicts exist, resolve only overlapping files**

Conflict rule: preserve current V88 infrastructure/auth/novel-fetch/deployment changes, then reapply Batch Factory behavior from the six commits. Do not replace whole current-V88 files with stale feature versions unless the file is Batch-Factory-only and unchanged on V88 since the merge base.

- [ ] **Step 4: Compare integration branch to V88**

Expected diff: Batch Factory implementation plus the two release docs; no V78 or unrelated rollback changes.

### Task 3: Validate code and contracts before V88 merge

**Files:**
- Test: existing Batch Factory Go tests under `backend/internal/batchfactoryv11/`.
- Test: existing frontend Batch Factory tests.
- Test: `tests/v88-build-info-release.test.js`
- Test: `tests/v88-public-unified-topology.test.js`
- Test: `tests/v88-public-release-identity.test.js`
- Test: `tests/v88-public-host-stage-retirement.test.js`

**Interfaces:**
- Consumes: integrated branch.
- Produces: verified merge candidate.

- [ ] **Step 1: Open PR from integration branch to `v88`**

This triggers V88-targeted checks.

- [ ] **Step 2: Inspect all PR workflow runs**

Expected: required Batch Factory and V88 release-contract checks pass.

- [ ] **Step 3: Inspect failed checks if any**

If a failure is caused by the integration, fix it on the integration branch and rerun. If failure is unrelated infrastructure, record evidence and do not claim code success without separating the cause.

- [ ] **Step 4: Merge the PR to `v88` only after verification**

Use the exact expected integration head SHA to prevent merging a moved branch accidentally.

### Task 4: Build the exact public release

**Files:**
- Use: `.github/workflows/v88-unified-public-image-release.yml`
- Verify: `.github/workflows/v88-direct-deploy-contract.yml`

**Interfaces:**
- Consumes: merged `v88` release SHA.
- Produces: `ghcr.io/<owner>/qiantie-v88-node:<SHA>` and `ghcr.io/<owner>/qiantie-go-api:<SHA>`.

- [ ] **Step 1: Record merged V88 SHA**

This SHA is the release identity for both images.

- [ ] **Step 2: Run/verify unified release workflow for that SHA**

Expected: frontend builds, Node image builds, Go image builds, both are published with the same immutable SHA tag.

- [ ] **Step 3: Record image/release evidence**

Capture workflow run ID, job result, artifact/image identity, and release SHA.

### Task 5: Cut over V88 public runtime

**Files:**
- Use existing V88 public Docker deployment topology under `deploy/v88-public/`.

**Interfaces:**
- Consumes: paired immutable images from Task 4.
- Produces: public V88 running the new exact release.

- [ ] **Step 1: Read pre-release public build identity**

Request `http://115.190.156.223:3000/api/build-info` and record the existing SHA before mutation.

- [ ] **Step 2: Deploy the paired Node and Go images for the new SHA**

Use the unified Docker runner/topology only. Do not use retired host-stage cutover and do not alter V78.

- [ ] **Step 3: Verify public build identity**

Expected: `/api/build-info` reports the newly merged V88 SHA.

### Task 6: Public functional acceptance

**Interfaces:**
- Consumes: public runtime from Task 5.
- Produces: acceptance evidence or a rollback decision.

- [ ] **Step 1: Verify `/batch-factory` loads publicly**

Expected: redesigned Batch Factory renders without session flash/redirect regression.

- [ ] **Step 2: Verify Batch Factory V11 API route**

Expected: public V11 route reaches the Go service instead of 404/503 topology failure.

- [ ] **Step 3: Verify redesigned workflow**

Check editable source persistence, per-book asset prompt isolation, book -> VIDEO -> shot navigation, split-duration constraints, simplified status list, and modules expanded by default.

- [ ] **Step 4: Verify unrelated V88 routes remain available**

At minimum check public build-info and novel-fetch entry points; do not interpret a third-party 121 timeout as a Batch Factory regression unless the V88 route itself is broken.

- [ ] **Step 5: Roll back if acceptance fails**

Restore the previously recorded immutable Node/Go image pair and verify public `/api/build-info` returns the pre-release SHA. Never switch to V78.

### Task 7: Completion evidence

- [ ] **Step 1: Record final V88 SHA and public build-info**
- [ ] **Step 2: Record PR, workflow run, and test results**
- [ ] **Step 3: Record changed files and reasons**
- [ ] **Step 4: Report any external blockers separately from code/deployment success**
