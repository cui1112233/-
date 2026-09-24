# H3 Storyboard Prompt Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render uncompiled H3 director cards as readable storyboard prompts with the complete visible operation bar.

**Architecture:** Add a pure formatter in the existing Batch Factory prompt component. Keep H3 JSON in Trace only; the precompiled branch reuses the established action labels and disables actions that require compiled VIDEO entities.

**Tech Stack:** React, Ant Design, Node.js `node:test` source assertions.

## Global Constraints

- Keep source on `v88` and deploy only an exact committed SHA.
- Do not modify persisted H3 data, current jobs, or video-provider submission behavior.
- Do not show raw JSON in the primary H3 director-card text area.

---

### Task 1: H3 card readable surface

**Files:**

- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

- [ ] Write a failing source test that requires `formatH3DirectorCardPrompt`, readable text in the precompiled textarea, no `JSON.stringify(card, null, 2)`, and visible 保存、编辑、生成视频、查看候选版本、查看 H3 Trace、重试 controls.
- [ ] Run `node --test --test-name-pattern='renders an uncompiled H3 card' frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js` and confirm the old raw-JSON branch fails.
- [ ] Format only persisted director-card fields into Chinese readable text. Use that formatter in the precompiled textarea. Render all controls; disable save/edit/video/candidates until a compiled VIDEO exists while keeping regenerate, Trace and retry actionable.
- [ ] Run the focused source test and `npm --prefix frontend run build`.
- [ ] Commit the source, test, specification, and plan as `fix(batch-factory): render H3 storyboard prompt surface`.
