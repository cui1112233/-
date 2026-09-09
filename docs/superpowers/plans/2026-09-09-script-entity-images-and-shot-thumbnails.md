# Script Entity Images and Shot Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Connect the existing novel-panel image-generation API to the script page's character/scene editor, preserve explicit main-image selection, and show each shot's selected reference images as visible thumbnails without changing shot-local reference semantics.

**Architecture:** Add a small frontend API wrapper for `/api/novel-panel/reference-assets/generate` and a pure payload builder for character/scene generation. The editor will append a generated result as a candidate only; the user must still click “设为主图”. The existing shot reference collector remains the single source of truth for character-first, scene-second, de-duplicated, nine-image H3 payloads. `ShotOutputCards` will render the collector's descriptors as image thumbnails plus the existing per-shot light/dark controls.

**Tech Stack:** React, Ant Design, Vite, Node's built-in test runner, existing Express novel-panel API.

## Global constraints

- Work only in the existing isolated v88 worktree on the current H3 integration candidate; do not modify `master`, V78, production, ECS, public deployment, or credentials.
- Preserve `ref_image_0` through `ref_image_8`, asynchronous video-task behavior, and the existing video URL contract.
- Do not infer or auto-select a main image. Generated images are candidates until the user explicitly selects one.
- Keep shot reference enabled/disabled state local to the current shot and do not mutate global character/scene media.
- Treat local tests and builds as source evidence only; real AutoDL image/video generation remains a separate verification boundary.
- Existing dirty build artifacts and unrelated files are outside this change and must not be staged or cleaned.

## Tasks

- [x] Add failing contracts for the image-generation payload/API wiring and visible shot thumbnails.
- [x] Run the focused RED tests and record the expected failures.
- [x] Implement the pure character/scene payload builder and novel-panel API wrapper.
- [x] Run the focused image-generation tests GREEN.
- [x] Wire the editor's “生成图片” action to append a candidate without selecting it as main.
- [x] Implement visible shot thumbnails while preserving per-shot controls and existing collector order/cap.
- [x] Run focused tests, the complete Node regression suite, and the frontend build.
- [x] Inspect the scoped diff, stage only the feature files, and commit on the current candidate branch.

## Verification commands

```powershell
node --test tests/script-entity-image-generation-contract.test.js tests/script-reference-thumbnail-contract.test.js
node --test frontend/src/user/pages/scriptVideoReferences.test.js frontend/src/user/pages/scriptEntityImages.test.js
node --test tests/*.test.js
node --test frontend/src/shared/api/*.test.js frontend/src/user/pages/*.test.js
npm run frontend:build
```

## Completion evidence

Report the actual modified files, exact commit SHA, RED failure output, GREEN commands/results, user-visible acceptance steps, and the fact that real external AutoDL generation is not established by local verification.
