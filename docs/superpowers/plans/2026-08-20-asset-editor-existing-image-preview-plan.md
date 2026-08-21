# Asset Editor Existing Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current primary image when editing an existing Shuihuo visual asset while retaining replacement upload behavior.

**Architecture:** `AssetsView` already loads every non-voice asset's image metadata. A small preview component selects the primary image, downloads it through the authenticated asset-image endpoint, and owns the object URL lifecycle. The file input retains its replacement upload behavior.

**Tech Stack:** React, Ant Design, existing Shuihuo asset-image API, Node test runner, Vite.

---

### Task 1: Lock the editor contract

**Files:**
- Modify: `tests/shuihuo-production-ui-contract.test.js`

- [ ] Add a failing UI contract test that requires `AssetEditorImagePreview`, `assetImages[editing.id]`, `downloadGeneratedAssetImage`, `点击或拖放替换图片`, and `URL.revokeObjectURL` in `AssetsView`.
- [ ] Run `node --test tests/shuihuo-production-ui-contract.test.js` and confirm it fails because the editor has no existing-image preview component.

### Task 2: Render existing and replacement previews

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

- [ ] Add `AssetEditorImagePreview({ images, replacementFile })`. It uses `images.find(image => image.isPrimary) || images[0]`, calls `downloadGeneratedAssetImage(image.id)` for saved images, calls `URL.createObjectURL(replacementFile)` for a local replacement, and revokes every object URL in cleanup.
- [ ] Pass `editing?.id ? assetImages[editing.id] || [] : []` and `assetImageFile` to the preview in the non-voice upload panel. Empty assets retain the upload placeholder; voice assets remain unchanged.
- [ ] Add image/overlay CSS inside `.shuihuo-asset-image-drop` so the image fills the right column and the replacement action remains readable.

### Task 3: Verify and commit

**Files:**
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] Run `node --test tests/shuihuo-production-ui-contract.test.js` and confirm it passes.
- [ ] Run `npm --prefix frontend run build && git diff --check` and confirm both pass.
- [ ] Confirm at `http://127.0.0.1:3000/shuihuo-production` that editing an image-backed asset shows its saved primary image and selecting a new file swaps the preview before saving.
- [ ] Commit only `AssetsView.jsx`, `shuihuo-production.css`, and `shuihuo-production-ui-contract.test.js` with message `fix: preview existing asset image in editor`.
