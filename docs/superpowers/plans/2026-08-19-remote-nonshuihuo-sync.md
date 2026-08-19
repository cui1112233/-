# Remote Non-Shuihuo Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import all executable remote workbench capabilities except Shuihuo production, while retaining current platform behavior and storing new runtime records in MySQL.

**Architecture:** Keep the existing Express/React gateway and Go/MySQL service boundaries. Selectively port pure UI and script/panel behavior, add account profile persistence to MySQL, and reimplement the remote novel-fetch workshop's file task store as a MySQL-backed API instead of importing its JSON storage.

**Tech Stack:** React, Ant Design, Express, Go, MySQL, Node test runner, Go test.

---

### Task 1: Establish the protected integration baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-08-19-remote-nonshuihuo-sync.md`

- [ ] Record remote refs, current source commit, excluded Shuihuo paths, and baseline test results.
- [ ] Confirm the isolated worktree has no user runtime data or uncommitted Shuihuo modifications.
- [ ] Commit the plan before functional changes.

### Task 2: Add account avatar and sidebar account identity

**Files:**
- Create: `frontend/src/shared/avatars.js`
- Modify: `frontend/src/shared/api/config.js`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: Go config/profile storage and migration files as required
- Test: `tests/avatar-settings.test.js`

- [ ] Write a failing test for a per-account avatar update and public readback.
- [ ] Store the selected preset identifier in MySQL and validate it against the built-in preset list.
- [ ] Render the selected avatar and username once in the sidebar footer; retain the current login, CM, theme, and navigation behavior.
- [ ] Run focused Node/Go tests and commit the feature.

### Task 3: Import script output safeguards and independent shot cards

**Files:**
- Create: `frontend/src/user/pages/scriptFinalSegment.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/scriptShotOutput.js`
- Modify: `frontend/src/user/pages/scriptConstraints.js`
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Modify: `routes/chat.js`
- Modify: relevant files in `prompts/`
- Test: `tests/script-final-segment.test.js`, `tests/script-shot-output.test.js`, `tests/script-segmented-budget.test.js`

- [ ] Write failing tests for normalized shot headings, independent card output, duration caps, and final-segment behavior.
- [ ] Port only non-Shuihuo script behavior and keep present CM collaboration additions.
- [ ] Enforce required shot-list headers in the server response path and retain existing user prompt ownership.
- [ ] Run focused tests, build the React frontend, and commit the feature.

### Task 4: Import novel panel stability and V78 workbench improvements

**Files:**
- Create: `public/novel-panel/workbench/clean-core/`
- Modify: `public/novel-panel/workbench/app.js`
- Modify: `public/novel-panel/workbench/character-core/character-core.js`
- Modify: `public/novel-panel/workbench/style.css`
- Modify: `routes/novel-panel.js`, `routes/novel-panel-page.js`, `routes/pages.js`
- Test: `tests/novel-panel-draft-persistence-contract.test.js`, `tests/novel-panel-iframe-sandbox.test.js`, `tests/novel-panel-v78-routes.test.js`

- [ ] Write failing regression tests for draft persistence, iframe sandboxing, stale character appearance responses, and repeated scene-time normalization.
- [ ] Port the V78 clean-core modules and route changes without altering Shuihuo assets, prompts, or data.
- [ ] Run panel-specific tests and commit the feature.

### Task 5: Build the novel-fetch workshop on MySQL

**Files:**
- Create: MySQL migration and Go store/HTTP handlers for workshop settings, jobs, source text, versions, and logs
- Create: `frontend/src/shared/api/novelFetchWorkshop.js`
- Create: `frontend/src/user/pages/NovelFetchWorkshopPage.jsx`
- Modify: `frontend/src/user/App.jsx`, `frontend/src/user/pages/NovelFetchPage.jsx`, Express proxy/mount routes
- Test: focused Node and Go workshop tests

- [ ] Write failing tests for account-scoped batch jobs and the gateway route contract.
- [ ] Reuse remote parser, classifier, rewrite, and upload UX semantics while persisting all runtime task records in MySQL.
- [ ] Do not import remote `data/` user files, sessions, credential files, or Shuihuo code.
- [ ] Run focused tests, frontend build, and commit the feature.

### Task 6: Validate and integrate

**Files:**
- Test: focused Node suites, relevant Go suites, `npm --prefix frontend run build`

- [ ] Verify no `shuihuo` source/data paths are included in feature commits.
- [ ] Review the commit diff against the current integration branch.
- [ ] Cherry-pick only non-Shuihuo commits into `integration/remote-workbench-20260819`, preserving its dirty user changes.
- [ ] Restart only after merge and verify `/settings`, `/script`, `/novel-fetch`, `/novel-panel`, and `/shuihuo-production` return successfully.
