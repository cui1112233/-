# V78.3.0.3 Source Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a source-backed, reproducible V78.3.0.3 baseline from the parentless production content snapshot without changing production behavior or importing later feature work.

**Architecture:** Start at `e4a8ebc4c50c40c383a6a39e69730b22e59c258e`, retain its extracted runtime and compiled frontend assets, and add only build inputs that can be traced to the V78 source tree. Use build failures and bundle evidence to identify missing modules, record provenance for each recovered file, and keep uncertain reconstruction explicitly labeled.

**Tech Stack:** Node.js, npm, React 18, Vite, Docker.

## Global Constraints

- Do not modify `master`, `:3000`, production volumes, production data, or the formal Go backend.
- Do not import V10, Go Settings, Config Snapshot, Inline Constraints, 121, Yadi, Drawer, or unrelated UI changes.
- Preserve V78 existing behavior, including the seven-book empty-batch fallback, simulated merge, legacy quick upload, and disabled single-book settings.
- Run `npm ci`, `npm --prefix frontend ci`, and `npm --prefix frontend run build` from a clean recovery checkout.
- Never record credentials, tokens, API keys, secrets, or user data.

## Recovery Tasks

### Task 1: Prove the baseline and capture toolchain metadata

**Files:**
- Create: `docs/batch-factory/v78-source-recovery-evidence.md`

- [ ] Record the `9baa60a` parent chain, prove `e4a8ebc` is the parentless production content snapshot, and list the post-snapshot Preset Migration commits.
- [ ] Record Node, npm, package-lock hashes, frontend lockfile availability, Vite version source, build command, and build-affecting environment variable names only.
- [ ] Inspect the production image extraction for source maps, manifests, and build metadata; record presence or absence with commands and hashes.

### Task 2: Restore traceable frontend build inputs

**Files:**
- Create: `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/admin.html`, `frontend/src/**`, and any strictly required static build inputs.
- Create: `docs/batch-factory/v78-source-recovery-manifest.tsv`

- [ ] Compare candidate files against the V78 source tree at `ee8eb9f64999b70fc1bde267472a1463375c6f9a` and reachable historical blobs.
- [ ] For every restored file, record path, source branch/ref, source commit, blob SHA, V78 evidence, and whether bytes were modified.
- [ ] Exclude Pixiu, Preset Migration, V10, Go migration, and later Drawer/settings files from the recovery tree.

### Task 3: Iterate clean dependency installation and build diagnostics

**Files:**
- Modify only source/build inputs identified by a concrete build error.
- Modify: `docs/batch-factory/v78-source-recovery-evidence.md`

- [ ] From a clean checkout run `npm ci` and capture the exit code and full missing-module output.
- [ ] Run `npm --prefix frontend ci` and capture the exit code and full output.
- [ ] Run `npm --prefix frontend run build`; resolve each missing import/module/CSS/asset/API/component only with provenance evidence, then repeat until the build is clean or an evidence-based blocker is documented.

### Task 4: Build and compare an isolated recovery image

**Files:**
- Modify: `Dockerfile` only if the extracted recipe cannot build the recovered source without changing runtime behavior.
- Create: `docs/batch-factory/v78-source-recovery-comparison.md`

- [ ] Build `qiantie-platform:v78-source-recovery-<recovery-sha>` without `latest` tags and record the full image digest.
- [ ] Compare `index.html`, manifests, all primary JS/CSS assets, Batch Factory chunks, and SHA-256 values against the V78 extracted assets.
- [ ] Run isolated API smoke checks for `/api/build-info`, Batch Factory GET APIs, intake, batch read, and prompt compile using a temporary port/volume only.
- [ ] Run the required UI route matrix and record pass/fail plus any unproven equivalence.

### Task 5: Update the branch map and stop at Phase 0

**Files:**
- Modify: `docs/batch-factory/BATCH_FACTORY_COMPLETE_DESIGN_AND_BRANCH_MAP.md` only in implementation status, production baseline, source reproducibility, and branch/SHA map sections.

- [ ] Add the pure snapshot SHA, recovery branch/final SHA, missing-file list, provenance summary, source-map result, toolchain, image tag/digest, static/UI/API comparison, and unresolved proof gaps.
- [ ] State whether the result is `reconstructed reproducible source baseline` or a stronger claim, based on the recorded evidence.
- [ ] Verify no forbidden feature migration or production mutation occurred, then commit the recovery changes and stop before Phase 1.
