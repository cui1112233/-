# Batch Audio Planning Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening the Batch Factory audio-planning toggle prepares per-book TTS duration without starting production.

**Architecture:** Reuse the page’s existing TTS measurement contract. The unified-settings save handler compares the old and new switch state; only an off-to-on change invokes the page callback. This browser-side preparation can read the generated audio metadata truthfully; it intentionally does not run Director or any production stage.

**Tech Stack:** React, Node.js `node:test`, V12 compatibility API, existing Batch Factory settings and automation controller.

## Global Constraints

- Maintain source on `v88`; no ECS-only changes.
- Never create a Director, image, video, merge, or upload task during toggle-time preparation.
- Preserve existing books, presets, audio durations, and user-provided manual durations.

---

### Task 1: Toggle-time preparation

**Files:** `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`, `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`.

- [ ] Add a failing source test asserting that a false-to-true `audioPlanningEnabled` save calls the existing per-book duration measurement, and does not invoke Director/production APIs.
- [ ] After settings save, prepare non-fixed books only when the switch changed from off to on. Each measurement uses configured TTS, reads audio metadata, and persists it with the latest book revision.
- [ ] Keep missing-duration automatic Director failures explicit for legacy batches; a separate server-side measurement capability requires a real source and is not implied by this toggle.
- [ ] Run the source test and `npm --prefix frontend run build`; commit `fix(batch-factory): prepare audio when planning is enabled`.

### Task 2: Release verification

- [ ] Push the exact `v88` SHA.
- [ ] Deploy only the Node service from that SHA and reload Nginx.
- [ ] Verify public `/api/build-info`, `/shuihuo-production`, and the authenticated toggle workflow.
