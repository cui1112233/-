# Batch Factory V11 Legacy Port Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one V11 integration candidate that preserves the current V11 React UI, imports the existing Go/MySQL Slice 1 authority, then ports proven Director/compiler behavior and reuses existing Shuihuo Production/Merge services so Codex only needs to start and smoke-test the finished candidate.

**Architecture:** Start from the latest V11 frontend line, import the Go-first Slice 1 files without reverting newer frontend/Novel Fetch work, and keep `/api/batch-factory/v11/*` as the only browser-facing V11 business API. Director/compiler rules become Go-owned; video production and FFmpeg merge are reused through adapters rather than reimplemented. React remains presentation/runtime wiring only and capabilities stay fail-closed until each server slice is durable and tested.

**Tech Stack:** React, Node/Express compatibility proxy, Go, MySQL 8.4, existing Shuihuo Production Go services, FFmpeg merge service.

**Spec:** `docs/superpowers/specs/2026-08-31-batch-factory-v11-personal-alpha-design.md`

## Global Constraints
- Base: `feat/batch-factory-v11-layout-showcase@59afd75da3d9b96b908b849931c5f28289a674d9`.
- Import Slice 1 authority from `release/production-v78.3.0.3-batch-factory-go-first@8aca2668b332d37f1c7c64030b17220621d74799` without merging historical 05/08/09/10 branches.
- Browser V11 business APIs remain `/api/batch-factory/v11/*`.
- Node is auth/session proxy only; Go/MySQL own V11 business state.
- Do not modify `master`, production `:3000`, production MySQL, or production volumes.
- Do not restore old Node file-store authority or legacy guessed 121 login API.
- Capabilities remain fail-closed until API + persistence + recovery tests are green.

---

### Task 1: Unified V11 baseline
- Import Go-first Slice 1 backend/proxy files into the current V11 UI branch without reverting frontend/Novel Fetch work.
- Preserve `/api/batch-factory/v11/*` browser paths.
- Commit the unified baseline.

### Task 2: Settings readback GREEN
- Use `backend/internal/batchfactoryv11/settings_readback_test.go` as the RED contract.
- Make `GetBatch()` return Batch/Book/VIDEO `settingsState.patch + revision`.
- Preserve sparse `false`, `""`, `0`, inheritance, and 409 revision semantics.
- Ensure Batch save never deletes Book/VIDEO overrides.

### Task 3: Go-owned Hook/Director
Sources: historical `routes/batch-factory.js`, `lib/batch-factory/director-output.js`, `lib/batch-factory/prompt-selection.js`.
- Port original/viral, Hook review/rewrite, characters/scenes/props, storyboard, source coverage, fixed-single-VIDEO, max-duration and normalization semantics.
- Persist Director state in V11 Go/MySQL.
- Add batch and single-book Director endpoints.

### Task 4: Go final prompt compiler
Sources: historical `lib/batch-factory/effective-settings.js`, `lib/batch-factory/video-prompt-compiler.js`.
- Resolve Batch → Book → VIDEO sparse settings in Go.
- Compile authoritative final VIDEO prompt and snapshot server-side.

### Task 5: Existing Shuihuo Production adapter
- Reuse existing Project/Segment/Task/Media and queue; do not create a second production system.
- Support single VIDEO, book, batch, partial failure, retry and restart recovery.

### Task 6: Real V11 VIDEO status/player/retry
Source behavior: historical `BatchFactoryVideoProductionStatus.jsx`.
- Keep current V11 layout.
- Wire real queued/running/succeeded/failed state, media preview/download and retry.

### Task 7: Existing Go FFmpeg merge adapter
- Reuse existing `shuihuo_batch_factory_merge_handlers.go` behavior.
- Persist V11 merged media reference/state; do not reimplement FFmpeg.

### Task 8: Prompt/draft UI wiring
Source behavior: historical `BatchConstraintSettings.jsx`.
- Use existing V11 prompts/drafts APIs.
- Personal prompt creation only on explicit user click.

### Task 9: Gate
- Focused Go tests, HTTP tests, V11 frontend tests, frontend build.
- Keep Publish/121 disabled for the Browser Worker phase.
- Return final SHA for Codex startup/smoke testing.
