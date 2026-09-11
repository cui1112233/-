# V88 Doubao Video Tab Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the maintained Doubao desktop executor source under V88 ownership and fix the live Doubao AI Creation page so the executor can switch from the default Image tab to the Video tab before filling and submitting a VIDEO prompt.

**Architecture:** V88 remains the sole consolidation target. Import only the maintained `local-executor/` source subtree from the existing V88 integration candidate, without merging its branch history. Then use TDD to update the page-control adapter so ARIA tab controls are treated as interactive controls, while preserving existing fail-closed behavior and post-click video-workspace polling.

**Tech Stack:** Node.js 22/24, Electron, `node:test`, Doubao DOM automation via `webContents.executeJavaScript`.

**Spec:** `docs/superpowers/specs/2026-09-01-v78-doubao-local-executor-full-replacement-design.md`

## Global Constraints

- All new maintained functionality must land on the V88 lineage; do not add new fixes to V78 feature/release branches.
- Base branch is `v88`; do not switch production or GitHub default branch during this fix.
- Preserve current V88 website behavior; import only the maintained local executor subtree required for this feature.
- No server/Go/MySQL behavior change is required for this bug.
- Fix the live-page root cause only; do not bundle unrelated executor UI copy changes.
- TDD: write and run the failing regression test before production code.

---

### Task 1: Bring maintained local executor source under V88

**Files:**
- Create subtree: `local-executor/**`

**Interfaces:**
- Consumes: existing V88 local-executor device/job backend and Node forwarding bridge.
- Produces: the source-controlled Electron executor package used for V88 Windows builds and future fixes.

- [ ] **Step 1: Copy the exact `local-executor/` tree from `integrate/v88-novel-body-executor@213fc21c464bba65be5b4493ffac014b0a397c9d` into a branch based on current `v88`.**
- [ ] **Step 2: Verify the imported baseline matches the source candidate for `doubao-page-actions.js`, `doubao-adapter.js`, and existing executor tests.**
- [ ] **Step 3: Commit the subtree import without changing runtime behavior.**

### Task 2: Add a failing live-tab regression test

**Files:**
- Modify: `local-executor/test/doubao-page-actions.test.js`

**Interfaces:**
- Consumes: `buildPreferredClickScript(labels)` from `local-executor/src/doubao-page-actions.js`.
- Produces: regression coverage proving a visible `[role="tab"]` labeled `视频` is clicked.

- [ ] **Step 1: Add a Node `vm`-based test with a fake visible element whose role is `tab`, label is `视频`, and click handler records activation.**
- [ ] **Step 2: Run `node --test test/doubao-page-actions.test.js` from `local-executor/`.**
- [ ] **Step 3: Confirm RED: the test fails because the generated control selector does not include `[role="tab"]`.**

### Task 3: Make Doubao page controls tab-aware

**Files:**
- Modify: `local-executor/src/doubao-page-actions.js`
- Modify: `local-executor/src/doubao-page-probe.js`

**Interfaces:**
- Consumes: existing preferred/exact click scripts and snapshot probe.
- Produces: tab-aware control discovery while preserving exact-label and ambiguity checks.

- [ ] **Step 1: Add `[role="tab"]` to the interactive selector used by preferred and exact click scripts.**
- [ ] **Step 2: Add `[role="tab"]` to the probe control selector so live snapshots report the Image/Video mode tabs.**
- [ ] **Step 3: Run `node --test test/doubao-page-actions.test.js` and confirm GREEN.**
- [ ] **Step 4: Run `npm test` and `npm run check` in `local-executor/` and confirm no regressions.**
- [ ] **Step 5: Commit only this root-cause fix and its regression test.**

### Task 4: V88 integration handoff

**Files:**
- Modify: `CURRENT_VERSION.md`

**Interfaces:**
- Produces: repository-level record that V88 owns the maintained desktop executor source and this Doubao tab fix.

- [ ] **Step 1: Record the local-executor source ownership/fix branch in `CURRENT_VERSION.md` without changing production/default-branch status.**
- [ ] **Step 2: Re-check that `v88` has not moved unexpectedly before promotion.**
- [ ] **Step 3: Fast-forward or merge the verified fix branch into `v88`; do not promote V88 to master/default yet.**
- [ ] **Step 4: Build a Windows test installer from the V88 lineage and manually verify one VIDEO task reaches `AI 创作 → 视频 → 填写提示词`.**
