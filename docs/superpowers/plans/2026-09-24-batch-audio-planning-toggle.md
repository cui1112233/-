# Batch Audio Planning Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening the Batch Factory audio-planning toggle prepares per-book TTS duration without starting production, and automation heals missing durations before Director.

**Architecture:** Keep duration preparation behind an automation adapter method and reuse the page’s existing TTS measurement contract. The unified-settings save handler compares the old and new switch state; only an off-to-on change invokes the page callback. The controller invokes the same adapter just before Director when the snapshot needs audio planning.

**Tech Stack:** React, Node.js `node:test`, V12 compatibility API, existing Batch Factory settings and automation controller.

## Global Constraints

- Maintain source on `v88`; no ECS-only changes.
- Never create a Director, image, video, merge, or upload task during toggle-time preparation.
- Preserve existing books, presets, audio durations, and user-provided manual durations.

---

### Task 1: Controller audio-duration preparation

**Files:** `lib/batch-factory-v11/automation-orchestrator.js`, `test/batch-factory-automation.test.js`.

- [ ] Write a failing test with an adapter `prepareAudioDuration` that records `audio`, then assert the order is `assets`, `audio`, `director` when `audioPlanningEnabled` is true.
- [ ] Run `node --test --test-name-pattern='prepares audio duration before director' test/batch-factory-automation.test.js` and confirm it fails because preparation is absent.
- [ ] Before Director, call optional `adapter.prepareAudioDuration({ owner, isOwner, batch, book, settings, job })` when audio planning is enabled. Preserve the existing per-book error behavior if preparation throws.
- [ ] Run `node --test test/batch-factory-automation.test.js` and commit `fix(batch-factory): prepare audio before automated director`.

### Task 2: Toggle-time preparation and adapter

**Files:** `routes/batch-factory-v11.js`, `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`, `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`.

- [ ] Add a failing source test asserting that a false-to-true `audioPlanningEnabled` save calls `ensureBookAudioDuration(book, { quiet: true })`, and does not invoke Director/production APIs.
- [ ] Add `prepareAudioDuration` to the automation adapter; it uses the configured TTS, reads the audio duration, and persists it with the latest book revision.
- [ ] Pass an audio-preparation callback to the settings drawer. After settings save, call it only for non-fixed books when the switch changed from off to on.
- [ ] Run the source test, `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test test/batch-factory-automation.test.js`, and `npm --prefix frontend run build`; commit `fix(batch-factory): prepare audio when planning is enabled`.

### Task 3: Release verification

- [ ] Push the exact `v88` SHA.
- [ ] Deploy only the Node service from that SHA and reload Nginx.
- [ ] Verify public `/api/build-info`, `/shuihuo-production`, and the authenticated toggle workflow.
