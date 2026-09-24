# Script Video History Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each historical video task from its freshly queried terminal state instead of treating every historical record as a playable video.

**Architecture:** Add a small pure merge helper that preserves a saved prompt while accepting server task data. The history-open handler refreshes tasks concurrently and the existing modal renders status-specific content.

**Tech Stack:** React, Ant Design, Node test runner.

## Global Constraints

- Do not submit or regenerate provider tasks while browsing history.
- A `<video>` element is only rendered for `succeeded` tasks with a valid URL.
- Preserve task prompts and history order.

---

### Task 1: Refresh and render historical task status

**Files:**
- Modify: `frontend/src/user/pages/scriptShotVideoTasks.js`
- Modify: `frontend/src/user/pages/scriptShotVideoTasks.test.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`

- [ ] **Step 1: Write the failing test**

Add a test proving that a server task result replaces `status`, `error`, and `videoUrl` while retaining the archived prompt.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/src/user/pages/scriptShotVideoTasks.test.js`

Expected: FAIL because the merge helper does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a pure `mergeShotVideoTaskHistoryTask(savedTask, freshTask)` helper. On opening the history modal, use `Promise.allSettled` with `getScriptVideoTask`, merge fulfilled results, and attach a local status-read error to rejected results. Render status-specific text in the existing modal.

- [ ] **Step 4: Run focused verification**

Run: `node --test frontend/src/user/pages/scriptShotVideoTasks.test.js`

Expected: PASS.

- [ ] **Step 5: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: successful production build.

- [ ] **Step 6: Commit**

Commit the source, test, design, and plan files with a `fix(script)` message.
