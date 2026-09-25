# Batch automation resume, retry, and persistent defaults implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default immediate execution to full submit, resume only unfinished stages, and persist unified defaults by account.

**Architecture:** Keep V12 batch settings for the active batch and add an account-default layer. Compute effective settings as account defaults, batch patch, then explicit book patch. Resume preserves a failed stage and uses status evidence to retry or read only that stage.

**Tech Stack:** Node.js, Express, Go V12 bridge, MySQL, React, Ant Design, Node test runner.

## Global Constraints

- All code reaches Git `v88` before public release.
- Unified settings persist by account, not only in browser state.
- Book overrides win; empty book fields inherit defaults.
- Immediate execution defaults to `full_submit`.
- Resume never recreates successful outputs or duplicates in-flight provider work.
- Retry transient failures after 30 seconds, 2 minutes, and 5 minutes only.

---

### Task 1: Account defaults and effective settings

**Files:** `routes/batch-factory-v11.js`, `routes/batch-factory-v11.test.js`, `frontend/src/shared/api/batchFactoryV11.js`.

**Interfaces:** Add `mergeBatchFactorySettings(defaultPatch, batchPatch, bookPatch)`. Add signed, account-scoped `GET|PUT /account-default-settings` bridge routes.

- [ ] Write a failing backend test: account defaults supply `textModelId` and `publishSettings.organization`; batch supplies `videoModelId` and `publishSettings.category`; a book supplies `textModelId`; assert the effective result is book text model, batch video model, and combined publish settings.
- [ ] Run `node --test routes/batch-factory-v11.test.js --test-name-pattern="inherit defaults"`; expect failure because the helper does not exist.
- [ ] Implement a three-layer shallow merge plus explicit deep merges for `publishSettings`, `aiPromptConfig`, and `aiPromptConfig.constraints`. Persist account defaults through existing account-scoped V12 storage; never use localStorage or a process-global JSON file.
- [ ] Rerun the focused test; expect PASS.
- [ ] Commit with `git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js frontend/src/shared/api/batchFactoryV11.js && git commit -m "feat(batch): persist and inherit account defaults"`.

### Task 2: Resume at the failed stage only

**Files:** `lib/batch-factory-v11/automation-orchestrator.js`, `lib/batch-factory-v11/automation-orchestrator.test.js`.

**Interfaces:** `resume({ owner, batchId })` preserves `stage`, sets `retryRequested`, and leaves `ready` books unchanged. `advanceBook` calls `adapter.retryStage` only when the V12 stage summary confirms the same failure.

- [ ] Write a failing controller test that seeds one `failed/director` book and one `ready/ready_for_upload` book; after resume and tick, assert only `retryStage(...director)` is called and the ready book remains ready.
- [ ] Run `node --test lib/batch-factory-v11/automation-orchestrator.test.js --test-name-pattern="resume retries only"`; expect failure because resume currently overwrites the stage with `pending`.
- [ ] Make the minimum change: for `failed` or `blocked`, set status `pending`, set `retryRequested: true`, clear `retryAt`, and use message `等待从失败阶段继续：${value.stage}`. Do not replace `value.stage`; do not touch ready books.
- [ ] Run `node --test lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js`; expect PASS.
- [ ] Commit with `git add lib/batch-factory-v11/automation-orchestrator.js lib/batch-factory-v11/automation-orchestrator.test.js && git commit -m "fix(batch): resume only unfinished stages"`.

### Task 3: Immediate execution and unified-settings UI

**Files:** `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`, `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx`, `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`.

**Interfaces:** Add `getBatchFactoryAccountDefaultSettings()` and `saveBatchFactoryAccountDefaultSettings(patch)`. Initialize immediate `automationRunMode` as `full_submit`.

- [ ] Write a failing source test asserting `useState('full_submit')`, both account-default API helper names, and the success copy `下次登录后恢复` appear in the two components.
- [ ] Run `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js --test-name-pattern="immediate automation defaults"`; expect failure.
- [ ] Load account defaults when unified settings opens. Save account defaults first, retain current batch save for current-batch effect, and show `统一配置已保存，下次登录后恢复`. Leave model selection empty when every layer lacks a model.
- [ ] Run `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js --test-name-pattern="immediate automation defaults"` and `(cd frontend && npm run build)`; expect PASS.
- [ ] Commit with `git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js && git commit -m "feat(batch): default immediate execution to full submit"`.

### Task 4: Regression and exact-SHA release

**Files:** Generated `frontend/dist/` only when the repository tracks the build output.

- [ ] Run `node --test lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js frontend/src/shared/api/batchFactoryV11.test.js`; expect PASS.
- [ ] Run `git status --short && git diff --check && git rev-parse HEAD`; expect only this feature and no whitespace errors.
- [ ] If tracked, commit generated assets. Push `v88` and require `git merge-base --is-ancestor HEAD origin/v88` to succeed.
- [ ] Deploy that exact SHA through the approved V88 Node path, restart Node/frontend only, and verify public build-info plus authenticated UI: default is full submit, unified settings survives reload/login, and resume identifies only the unfinished stage.
