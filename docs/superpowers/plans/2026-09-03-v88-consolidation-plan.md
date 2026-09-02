# V88 Repository Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `v88` as the single clean Qiantie integration/mainline candidate by selectively bringing in the newest correct implementation of each core subsystem without blindly merging legacy, deployment, design, plan, snapshot, or duplicate branches.

**Architecture:** V88 began from the broad integrated Go + Novel Fetch + Doubao executor line. Each subsystem must be audited against competing branches, then integrated one at a time with regression verification after every integration. Full-branch merges are allowed only when ancestry and scope are proven safe; otherwise use selective commits/files.

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

- [x] Preserve the pre-consolidation V88 pointer at `archive/v88-pre-consolidation-20260903`.
- [x] Establish V88 from the integrated Go + Novel Fetch + Doubao baseline.
- [x] Add/maintain `CURRENT_VERSION.md` and `QIATIE_REPOSITORY_MEMORY.md`.
- [x] Identify major Novel Fetch, Batch Factory V11, Doubao, 121, release, plan/design and deployment branch families.
- [ ] Finish classifying all remaining candidate branches as `integrate`, `reference-only`, `obsolete`, `plan/design`, `deployment-only`, `duplicate`, or `unknown-needs-review`.

### Task 2: Novel Fetch

Candidate branches include `integration/v78-novel-fetch-v2-final-20260902`, `fix/novel-fetch-v2-121-hardening-56a4278`, `fix/novel-fetch-v2-121-review-56a4278`, `fix/novel-fetch-sparse-ai-versions`, `feat/v78-novel-fetch-local-first-*`, `feat/v78-novel-fetch-go-bridge`, and the production timeout hotfix.

Required behavior: sparse AI selections (AI1 means AI1, AI1+AI5 means only AI1+AI5), no separate numeric AI quantity, cancellation finishes current work then stops remaining work, task/upload selection consistency, local-first body storage/history separation, and name + blue/red dot 121 login UX.

- [x] Integrate local executor novel body persistence from `feat/v78-novel-fetch-local-first-s2-executor` through PR #11.
- [x] Integrate local-first Go body lifecycle core from `feat/v78-novel-fetch-local-first-s2-go` through PR #13.
- [x] Add V88 Go Integration Guard and verify the body lifecycle both before merge and again on merged V88.
- [ ] Reconcile Novel Fetch body-sync leasing with the newer V88 Local Executor architecture.
- [ ] Compare sparse-AI and final Novel Fetch V2/121 candidate ancestry against latest V88.
- [ ] Select authoritative implementation per file/behavior and integrate selectively.
- [ ] Run complete Novel Fetch and Browser Worker/121 regression tests.

### Task 3: Batch Factory V11

Candidate branches include `feat/batch-factory-v11-layout-showcase`, `feat/batch-factory-v11-frontend-alpha-s1`, `feat/batch-factory-v11-integrated-runtime`, `feat/batch-factory-v11-legacy-port-runtime`, `release/production-v78.3.0.3-batch-factory-go-first`, `integration/go-batch-baseline-20260830`, `10-batch-factory-go-api-migration`, `10-batch-factory-inline-constraints-version-config`, and `08-batch-factory-unified-settings-version-sync`.

- [ ] Preserve current V11 React UI/runtime states, sparse settings, revision fail-closed, capability gate, Go/MySQL backend, unified settings/version config, and constraint settings.
- [ ] Split release-line changes into authoritative backend fixes versus unrelated/conflicting history; PR #10 proves a whole-branch merge is unsafe.
- [ ] Keep production snapshot material reference-only unless it uniquely contains required source behavior.
- [ ] Validate frontend build, Node tests, Go tests, and MySQL migration/startup.

### Task 4: Doubao local executor

Candidate branches include `feat/v78-doubao-local-executor-replacement`, `feat/v78-doubao-local-executor-s1`, `feat/v78-doubao-local-executor-s5-artifact-return`, `feat/v78-go-integrated-novel-fetch-doubao`, and `08-doubao-generic-async-executor`.

- [x] Use `feat/v78-go-integrated-novel-fetch-doubao` as the integrated V88 foundation; it already supersedes S5 artifact-return history.
- [ ] Audit `08-doubao-generic-async-executor` and any later executor deltas against current V88.
- [ ] Confirm one authoritative executor/artifact-return path and avoid duplicate architectures.
- [ ] Run executor end-to-end contracts.

### Task 5: 121 / Browser Worker

- [ ] Preserve multi-user session isolation, web-triggered login, primary + fallback device behavior.
- [ ] Verify Browser Worker is wired into runtime/container, not just passing isolated tests.
- [ ] Integrate only late 121 fixes missing from V88.
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
- [x] Ensure repository governance memory exists on V88.
- [ ] Change GitHub default branch from `master` to `v88` only after full gate passes.
- [ ] Only then archive/delete obsolete V78 feature/fix/integration branches whose unique work is already preserved.
- [ ] Add production CI guardrails so production embeds and verifies its Git SHA.
