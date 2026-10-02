# Automation Preset Model Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent ordinary account settings saves from deleting the model catalog so automation presets remain executable and inherited by the batch and books.

**Architecture:** Keep model management isolated behind the model catalog endpoints. The generic config save route performs a field-preserving update and carries the existing catalog unchanged. Existing automation start validation remains the fail-fast gate before queueing.

**Tech Stack:** Node.js, Express, node:test, React/Vite public deployment.

## Global Constraints

- Preserve public Docker volumes and existing batch data.
- Do not copy model credentials into presets or batch settings.
- Deploy through the authorized direct SSH release path, not GitHub Actions.

---

### Task 1: Preserve the account model catalog

**Files:**
- Modify: `routes/config.js`
- Test: `routes/config-retention.test.js`

**Interfaces:**
- Consumes: `configReader(username)` returning the current account configuration.
- Produces: `POST /api/config` writes a new configuration that retains `modelCatalog` and `modelCatalogVersion` unchanged.

- [ ] **Step 1: Write the failing test**

Add a manager account fixture with an enabled text model and credential, save an unrelated retention preference, and assert the writer still receives the same model catalog and version.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test routes/config-retention.test.js`

Expected: the model catalog assertion fails because the generic save payload omits it.

- [ ] **Step 3: Write minimal implementation**

Copy `oldConfig.modelCatalog` and `oldConfig.modelCatalogVersion` into the manager `nextConfig`. Do not accept these fields from the request body.

- [ ] **Step 4: Run focused and related tests**

Run: `node --test routes/config-retention.test.js routes/config-model-verification.test.js routes/config.script-defaults.test.js routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit source and tests**

Commit only the two source/test files and these design documents; do not include existing `frontend/dist` artifacts.

### Task 2: Release and verify the public path

**Files:**
- No source additions; package the committed SHA with the existing direct-release process.

**Interfaces:**
- Consumes: tested Git commit SHA.
- Produces: public `/api/build-info` reports that SHA and authenticated config saves preserve the catalog.

- [ ] **Step 1: Build the frontend and backend release package**

Use the repository's existing V88 direct-release packaging path.

- [ ] **Step 2: Activate through the server direct-release script**

Run `/opt/qiantie/v88/direct/activate-direct-release.sh <sha>` on the authorized host.

- [ ] **Step 3: Verify runtime identity and health**

Check `/api/build-info`, `/api/health`, and the public Shuihuo page.

- [ ] **Step 4: Verify data preservation**

Confirm the original Docker data volume remains mounted and the automation preset/task records still exist.

- [ ] **Step 5: Report the remaining credential recovery boundary**

If no trusted backup contains the overwritten catalog, clearly state that the user must add the model once in Personal Center before retrying; do not fabricate credentials.

