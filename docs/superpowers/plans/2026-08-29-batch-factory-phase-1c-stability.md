# Batch Factory Phase 1C Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Phase 1 consistency holes before further Batch Factory migration: cache/list freshness, atomic bootstrap, authoritative model canonicalization during bootstrap, invalid-scope write protection, and director invalidation when video-model capability changes.

**Architecture:** Keep Node as a temporary compatibility shell only. Go/MySQL remains authoritative for migrated settings. Node may supply legacy state during one-time bootstrap and may apply a Go-returned invalidation effect to the still-legacy Batch/Item records, but Go decides whether invalidation is required. Do not migrate director execution, prompt compiler, production orchestration, or publish in this plan.

**Tech Stack:** Go, chi, database/sql, MySQL migrations, Node/Express compatibility bridge, Node test runner, GitHub Actions, React/Vite regression build.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-go-api-migration-design.md`

## Global Constraints

- API / service backend target is Golang.
- Admin UI and User UI remain React + Ant Design.
- Node / Express is only a temporary compatibility layer and must not become a second source of truth.
- No provider credentials move into Batch Factory, Node, React, or browser storage.
- Keep rollback cheap and do not touch director execution, final prompt compilation, video production orchestration, merge, or publish in this plan.
- Use TDD for every behavior change and keep the existing Batch Factory regression suite green.

---

### Task 1: Settings list/cache consistency

**Files:**
- Modify: `lib/batch-factory/settings-state-bridge.js`
- Modify: `lib/batch-factory/settings-aware-store.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `routes/batch-factory.js`
- Test: `test/batch-factory-settings-state-bridge.test.js`
- Test: `test/batch-factory-settings-hydration-contract.test.js`

**Interfaces:**
- Consumes: Go `GET /api/shuihuo-production/batch-factory/batches/{batchId}/settings-state`.
- Produces: `refreshPersistedSettingsState(...)`; successful settings/override saves update or invalidate the in-memory state cache; batch-list reads hydrate persisted settings rather than silently returning stale legacy JSON after process restart.

- [ ] **Step 1: Write failing tests** proving that a cold-cache batch list loads Go state and that successful settings/override saves refresh the cache used by `listBatches()`.
- [ ] **Step 2: Run the focused Node tests** and verify they fail on the current implementation.
- [ ] **Step 3: Implement minimal cache refresh/list hydration behavior** without persisting migrated settings back into legacy JSON.
- [ ] **Step 4: Re-run focused tests** and verify GREEN.
- [ ] **Step 5: Commit** with `fix: keep batch factory settings cache authoritative`.

### Task 2: Atomic bootstrap

**Files:**
- Modify: `backend/internal/shuihuo/batchfactory/settings_store.go`
- Test: `backend/internal/shuihuo/batchfactory/settings_store_test.go`

**Interfaces:**
- Consumes: `PersistedSettingsState` legacy snapshot.
- Produces: `BootstrapBatchState(ctx, userID, batchID, legacy)` that imports item/video rows and the batch ownership marker in one SQL transaction; if any write fails, none of the bootstrap rows become authoritative.

- [ ] **Step 1: Write a failing store test** whose fake DB fails a mid-bootstrap write and asserts no partial rows remain.
- [ ] **Step 2: Run `go test ./internal/shuihuo/batchfactory`** and verify RED.
- [ ] **Step 3: Refactor save/load helpers to accept a transaction executor** and make `BootstrapBatchState` use `BeginTx`, `Rollback`, and `Commit`.
- [ ] **Step 4: Re-run the Go package tests** and verify GREEN.
- [ ] **Step 5: Commit** with `fix: make batch factory settings bootstrap atomic`.

### Task 3: Canonical bootstrap model snapshot

**Files:**
- Modify: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go`
- Test: `backend/internal/httpapi/shuihuo_batch_factory_settings_bootstrap_test.go`

**Interfaces:**
- Consumes: legacy batch settings plus the authenticated user and Go model catalog.
- Produces: bootstrap batch settings canonicalized through the same `canonicalizeBatchFactorySettings` path used by normal settings saves, so browser/legacy `videoModelVersionId`, `videoModelName`, and `maxVideoDuration` are never authoritative.

- [ ] **Step 1: Add failing HTTP tests** with intentionally stale legacy model metadata and assert the bootstrap response/store use the server model version/name/max duration.
- [ ] **Step 2: Run the focused Go HTTP tests** and verify RED.
- [ ] **Step 3: Canonicalize `req.State.Batch` before calling `BootstrapBatchState`** and preserve sparse item/video overrides.
- [ ] **Step 4: Re-run focused Go tests** and verify GREEN.
- [ ] **Step 5: Commit** with `fix: canonicalize legacy model snapshot during bootstrap`.

### Task 4: Guard invalid settings scopes during compatibility period

**Files:**
- Modify: `backend/internal/shuihuo/batchfactory/settings_store.go`
- Modify: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go`
- Modify: `routes/batch-factory-controls.js`
- Test: `backend/internal/httpapi/shuihuo_batch_factory_settings_persistence_test.go`
- Test: `test/batch-factory-go-settings-bridge.test.js`

**Interfaces:**
- Consumes: existing MySQL batch ownership marker plus compatibility-layer existence checks for item/video records.
- Produces: Go rejects item/video override writes unless the batch settings ownership marker exists; Node remains responsible only for verifying the still-legacy item/video exists before forwarding. This removes arbitrary non-batch writes now and documents the remaining item/video FK limitation until main Batch records move to Go.

- [ ] **Step 1: Add failing Go tests** proving item/video override writes return `404` when no persisted batch marker exists.
- [ ] **Step 2: Add/retain Node bridge tests** proving nonexistent item/video never reaches Go because compatibility routing returns `404` first.
- [ ] **Step 3: Add `SettingsStore.BatchExists(...)` and enforce it in Go override handlers.**
- [ ] **Step 4: Re-run focused Go + Node tests** and verify GREEN.
- [ ] **Step 5: Commit** with `fix: reject orphan batch factory setting scopes`.

### Task 5: Video-model changes invalidate existing director output

**Files:**
- Modify: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go`
- Modify: `routes/batch-factory-controls.js`
- Test: `backend/internal/httpapi/shuihuo_batch_factory_settings_handlers_test.go`
- Test: `test/batch-factory-go-settings-bridge.test.js`

**Interfaces:**
- Consumes: previous persisted canonical settings and newly canonicalized settings.
- Produces: settings-save response field `directorRegenerationRequired: boolean`, true when the selected video model or its authoritative max-duration capability changes. Node compatibility code applies only this Go-decided effect to still-legacy item state by clearing stale director/production fields and returning items to `pending`.

- [ ] **Step 1: Add failing Go HTTP tests** proving identical model capability returns false and changed model ID/max duration returns true.
- [ ] **Step 2: Add failing Node compatibility test** proving a true invalidation response clears old director/production state while false leaves it untouched.
- [ ] **Step 3: Implement Go invalidation decision from canonical previous/next settings and return it with the settings payload.**
- [ ] **Step 4: Implement the minimal Node compatibility effect** driven solely by the Go flag; do not recompute the condition in Node.
- [ ] **Step 5: Re-run focused tests** and verify GREEN.
- [ ] **Step 6: Commit** with `fix: invalidate stale director output after model changes`.

### Task 6: Full Phase 1C verification

**Files:**
- Modify only if a test harness needs to include a newly added focused test: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: evidence that the complete migration branch remains regression-safe.

- [ ] **Step 1: Run Go Batch Factory unit/storage tests.**
- [ ] **Step 2: Run focused Go HTTP Batch Factory tests.**
- [ ] **Step 3: Run Node Batch Factory bridge/hydration/inheritance/regression tests.**
- [ ] **Step 4: Run React production build.**
- [ ] **Step 5: Review `master...10-batch-factory-go-api-migration` diff and verify no unrelated feature area changed in Phase 1C.**
- [ ] **Step 6: Stop on the migration branch; do not merge master or deploy without explicit user instruction.**
