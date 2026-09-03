# Pin V78 Public Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the public V78 Node service on the approved Novel Fetch V2 image and prevent mutable tags or unverified source directories from replacing it.

**Architecture:** The public Compose service will consume an explicitly supplied image reference and verify its immutable digest and OCI revision before startup. ECS will use the already transferred target image with `--no-build`; rollback will select a separately declared image reference instead of retagging the production name.

**Tech Stack:** Docker Compose, Bash, Node.js tests, OCI image metadata.

## Global Constraints

- Target Node revision: `fc1f5a96364518f0f14073fd5195363ef0e15a77`.
- Target Node digest: `sha256:7170d92a9cac698fb021ff9a354a418ec946d4a0316a9229de119484e2f25474`.
- Do not recreate MySQL, browser-worker, or data/session volumes during the Node switch.
- Do not print or commit `.env` secrets.
- Do not build the public Node image from the unpinned ECS source directory.

---

### Task 1: Add release image provenance guard

**Files:**
- Modify: `deploy/v78-public/deploy.sh`
- Test: `tests/v78-public-deploy-contract.test.js`

**Interfaces:**
- Consumes: `QIANTIE_NODE_IMAGE`, `QIANTIE_NODE_EXPECTED_DIGEST`, and `QIANTIE_NODE_EXPECTED_REVISION`.
- Produces: a deploy preflight that exits 0 only when the local Docker image reference resolves to the expected image ID/digest and OCI revision.

- [x] **Step 1: Write the contract test**

Add contract assertions that the deploy script checks the image digest and OCI revision before any build or service update.

- [x] **Step 2: Run the contract test**

Run: `node --test tests/v78-public-deploy-contract.test.js`

Expected: PASS after the deployment contract is present.

- [x] **Step 3: Write minimal implementation**

Make `deploy.sh` require the image, expected digest, and expected revision values, call `docker image inspect` without exposing configuration, compare the resolved image ID to the expected digest, and compare `org.opencontainers.image.revision` to the expected revision.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/v78-public-deploy-contract.test.js`

Expected: PASS with the provenance guard covered.

- [x] **Step 5: Commit**

Run: `git add deploy/v78-public/deploy.sh tests/v78-public-deploy-contract.test.js && git commit -m "fix: verify public V78 node image provenance"`

### Task 2: Version the public image-selection contract

**Files:**
- Create: `deploy/v78-public/docker-compose.yml`
- Create: `deploy/v78-public/deploy.sh`
- Create: `deploy/v78-public/rollback.sh`
- Test: `tests/v78-public-deploy-contract.test.js`

**Interfaces:**
- Consumes: `.env` values for service credentials and the immutable Node image/revision values.
- Produces: a Compose contract that starts `v78-node` with `--no-build`, preserves existing named volumes, and never retags `public-v78`.

- [x] **Step 1: Write the contract test**

Assert the Compose contract uses `${QIANTIE_NODE_IMAGE:?}` for `v78-node`, has no Node `build` block, the deploy script invokes the provenance guard and `up -d --no-build`, and the rollback script contains no `docker tag` operation.

- [x] **Step 2: Run the contract test**

Run: `node --test tests/v78-public-deploy-contract.test.js`

Expected: PASS after the versioned public deployment contract is present.

- [x] **Step 3: Write minimal implementation**

Create the production-safe Compose contract from the verified ECS topology, preserve the existing Go and browser-worker build boundaries, make Node image selection explicit, and make deploy/rollback refuse missing or mismatched image metadata.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/v78-public-deploy-contract.test.js`

Expected: PASS with no mutable production Node tag or Node build path.

- [x] **Step 5: Commit**

Run: `git add deploy/v78-public tests/v78-public-deploy-contract.test.js && git commit -m "fix: pin public V78 deployment image"`

### Task 3: Restore and verify the public ECS service

**Files:**
- Modify: `/opt/qiantie/v78/deploy/v78-public/docker-compose.yml`
- Modify: `/opt/qiantie/v78/deploy/v78-public/deploy.sh`
- Modify: `/opt/qiantie/v78/deploy/v78-public/rollback.sh`

**Interfaces:**
- Consumes: existing ECS target image `qiantie-v78-node@sha256:7170d92a...` and existing `.env`.
- Produces: one running `v78-node` container using the target digest, with Nginx serving the V2 resources.

- [x] **Step 1: Back up the three ECS files with an explicit timestamp**
- [x] **Step 2: Patch ECS Compose and scripts using a local `apply_patch` plus audited file transfer**
- [x] **Step 3: Run `docker compose config --quiet` and the provenance guard**
- [x] **Step 4: Recreate only `v78-node` with `docker compose up -d --no-build --no-deps v78-node`**
- [x] **Step 5: Verify Nginx continues to resolve the recreated Node service**
- [x] **Step 6: Verify container digest, public `/novel-fetch`, all five V2 resources, and unchanged MySQL/worker containers and named volumes**

### Task 4: Final regression verification

**Files:**
- Test: `tests/v78-public-deploy-contract.test.js`

- [x] **Step 1: Run the focused repository tests**

Run: `node --test tests/v78-public-deploy-contract.test.js`

- [x] **Step 2: Run the frontend build from the isolated target worktree**

Run: `npm --prefix frontend run build`

- [x] **Step 3: Run fresh public HTTP checks**

Verify the public Node image digest is the target digest, `/novel-fetch` loads the target bundle, and each V2 script returns HTTP 200.
