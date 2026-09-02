# V88 Repository Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `v88` as the single clean Qiantie integration/mainline candidate by selectively bringing in the newest correct implementation of each core subsystem without blindly merging legacy, deployment, design, plan, snapshot, or duplicate branches.

**Architecture:** V88 began from the broad regression line and may receive concurrent validated fixes. Each subsystem must be audited against competing branches, then integrated one at a time with regression verification after every integration. Full-branch merges are allowed only when ancestry and scope are proven safe; otherwise use selective commits/files.

**Tech Stack:** Git/GitHub, Node.js, React, Go, MySQL 8.4, Browser Worker/121 integration.

## Global Constraints

- `v88` is an integration candidate until all gates pass; do not make it the default branch early.
- Never blindly merge every V78 branch.
- Do not integrate `plan/*`, `design/*`, `ops/*`, production snapshot-only branches, generated `dist`, `node_modules`, worktree copies, or known duplicate branches as source code.
- Production must ultimately map to one Git SHA.
- A feature is only complete when present and tested on `v88`.
- If V88 moves during consolidation, re-read its HEAD before every write/merge; do not overwrite concurrent validated work.

---

### Task 1: Baseline and inventory

- [ ] Re-read latest `v88` HEAD before each integration operation.
- [ ] Maintain `CURRENT_VERSION.md` as the authoritative consolidation status file.
- [ ] Inventory branches for Novel Fetch, Batch Factory V11, unified settings/version sync, Doubao executor, 121/Browser Worker, Go backend, and deployment/runtime.
- [ ] Classify each candidate as `integrate`, `reference-only`, `obsolete`, `plan/design`, `deployment-only`, `duplicate`, or `unknown-needs-review`.

### Task 2: Novel Fetch

Candidate branches include `integration/v78-novel-fetch-v2-final-20260902`, `fix/novel-fetch-v2-121-hardening-56a4278`, `fix/novel-fetch-v2-121-review-56a4278`, `fix/novel-fetch-sparse-ai-versions`, `feat/v78-novel-fetch-local-first-*`, `feat/v78-novel-fetch-go-bridge`, and the production timeout hotfix.

Required behavior: sparse AI selections (AI1 means AI1, AI1+AI5 means only AI1+AI5), no separate numeric AI quantity, cancellation finishes current work then stops remaining work, task/upload selection consistency, and name + blue/red dot 121 login UX.

- [ ] Compare candidate ancestry and changed files against latest V88.
- [ ] Select authoritative implementation per file/behavior.
- [ ] Integrate selectively.
- [ ] Run Novel Fetch and Browser Worker/121 regression tests.

### Task 3: Batch Factory V11

Candidate branches include `feat/batch-factory-v11-layout-showcase`, `feat/batch-factory-v11-frontend-alpha-s1`, `feat/batch-factory-v11-integrated-runtime`, `feat/batch-factory-v11-legacy-port-runtime`, `release/production-v78.3.0.3-batch-factory-go-first`, `integration/go-batch-baseline-20260830`, `10-batch-factory-go-api-migration`, `10-batch-factory-inline-constraints-version-config`, and `08-batch-factory-unified-settings-version-sync`.

- [ ] Preserve current V11 React UI/runtime states, sparse settings, revision fail-closed, capability gate, Go/MySQL backend, unified settings/version config, and constraint settings.
- [ ] Keep production snapshot material reference-only unless it uniquely contains required source behavior.
- [ ] Validate frontend build, Node tests, Go tests, and MySQL migration/startup.

### Task 4: Doubao local executor

Candidate branches include `feat/v78-doubao-local-executor-replacement`, `feat/v78-doubao-local-executor-s1`, `feat/v78-doubao-local-executor-s5-artifact-return`, `feat/v78-go-integrated-novel-fetch-doubao`, and `08-doubao-generic-async-executor`.

- [ ] Audit current V88 first because Doubao fixes may already be landing there.
- [ ] Select one authoritative executor path and artifact-return contract.
- [ ] Avoid duplicate executor architectures.
- [ ] Run executor tests and end-to-end contracts.

### Task 5: 121 / Browser Worker

- [ ] Preserve multi-user session isolation, web-triggered login, primary + fallback device behavior.
- [ ] Verify Browser Worker is wired into runtime/container, not just passing isolated tests.
- [ ] Run complete Browser Worker regression suite.

### Task 6: Full V88 gate

- [ ] Frontend build passes.
- [ ] Complete Node tests pass or all remaining failures are explicitly documented and accepted.
- [ ] Complete Go tests pass.
- [ ] Browser Worker/121 tests pass.
- [ ] MySQL 8.4 empty-database startup/migrations pass.
- [ ] Novel Fetch, Batch Factory, unified settings, Doubao executor, and 121 work from the V88 tree.

### Task 7: Promotion and cleanup

- [ ] Update `CURRENT_VERSION.md` with final V88 HEAD, production SHA, canonical source entry points, and verification results.
- [ ] Ensure repository governance memory exists on V88.
- [ ] Change GitHub default branch from `master` to `v88` only after full gate passes.
- [ ] Only then archive/delete obsolete V78 feature/fix/integration branches whose unique work is already preserved.
- [ ] Add CI guardrails so production embeds and verifies its Git SHA.
