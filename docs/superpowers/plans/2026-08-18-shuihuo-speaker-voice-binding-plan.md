# Shuihuo Speaker Voice Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve each storyboard row's AI-identified speaker and use that character's configured voice for direct TTS generation.

**Architecture:** Smart segmentation candidates gain a `speaker` value. Confirming a candidate persists that value on the storyboard row, defaulting to `旁白` for manual segmentation or legacy model output. Character assets persist an optional voice-asset reference; TTS resolves a row's speaker to that character reference, then falls back to the platform default narrator voice.

**Tech Stack:** Go, MySQL migrations, React, Ant Design, Node test runner, Go testing.

---

### Task 1: Add failing behavior tests

**Files:**
- Modify: `backend/internal/shuihuo/providers/text_completion_test.go`
- Modify: `tests/shuihuo-direct-narration.test.mjs`

- [ ] Parse a smart-segmentation candidate containing `speaker`, normalize empty input to `旁白`, and verify the expected role-to-voice fallback rules.
- [ ] Run the focused tests and confirm they fail because the fields and resolver do not yet exist.

### Task 2: Persist speaker and character voice references

**Files:**
- Modify: `backend/internal/shuihuo/domain/types.go`
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/shuihuo/store/segments.go`
- Modify: `backend/internal/shuihuo/store/source_units.go`
- Modify: `backend/internal/shuihuo/store/assets.go`
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_storyboard_handlers.go`

- [ ] Add nullable `voice_asset_id` to character assets and non-null `speaker` to storyboard rows with safe migration defaults.
- [ ] Carry `speaker` from smart candidates through confirmation, load it in project snapshots, and accept manual correction on storyboard update.
- [ ] Ensure all asset reads/writes preserve a character's voice reference.

### Task 3: Expose and consume the mapping in the workbench

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StoryboardRow.jsx`
- Modify: `frontend/src/user/pages/shuihuo/directNarration.js`

- [ ] Add a character-editor selector for a project voice preset.
- [ ] Show a row speaker selector containing `旁白` and its bound character presets.
- [ ] Resolve direct TTS using the selected speaker's character voice; retain per-row rate/pitch and default narrator fallback.

### Task 4: Verify the contract

**Files:**
- Test: focused Go provider/store/http tests
- Test: `tests/shuihuo-direct-narration.test.mjs`

- [ ] Run tests, format Go files, build the frontend, and check the diff for whitespace errors.
- [ ] Restart the managed backend and perform a no-quota local HTTP smoke check of the persisted contract.
