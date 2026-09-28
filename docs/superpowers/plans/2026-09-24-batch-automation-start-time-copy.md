# Batch Automation Start-Time Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Batch Factory scheduling unambiguously mean “start automated production at this time”, never “submit at this time”.

**Architecture:** The scheduler already releases a job from `scheduled` to `running` at `scheduledAt`; it then advances the book through its selected run mode. Keep that behavior unchanged. Change only the two scheduling surfaces and their source-level regression tests so that labels and helper text describe this lifecycle consistently.

**Tech Stack:** React, Ant Design, Node built-in test runner.

## Global Constraints

- `scheduledAt` releases the automation job into production; it is not a publish deadline.
- `full_submit` uploads only after the generated and merged video is ready.
- Do not alter existing batches, automation presets, jobs, media records, or upload settings.
- All changes land on the V88 lineage before deployment.

---

### Task 1: Make the existing-batch scheduler dialog describe a start time

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx:2943-2949`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

**Interfaces:**
- Consumes: existing `automationScheduledAt` and `automationRunMode` state.
- Produces: unchanged `startBatchAutomation(batch.id, { presetId, runMode, scheduledAt })` input, with clear visible lifecycle wording.

- [ ] **Step 1: Write the failing test**

```js
test('labels scheduled automation as a production start time rather than a submit time', () => {
  assert.match(source, /自动启动时间/);
  assert.match(source, /到点启动自动生产；生成、合成与上传按后续流程继续/);
  assert.match(source, /成片完成后自动上传视频管理系统/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: FAIL because the current dialog only contains `执行时间`.

- [ ] **Step 3: Write minimal implementation**

Replace the label with `自动启动时间`, keep the datetime value and request field unchanged, and add one helper sentence below it. Add the post-production meaning directly to the `全自动生成并提交` option label.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: PASS.

### Task 2: Align the new-batch scheduler dialog with the same lifecycle

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx:343-357`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

**Interfaces:**
- Consumes: existing `scheduledAt`, `automationRunMode`, and `buildManualBatchSubmission` contract.
- Produces: unchanged manual-intake payload with a clear start-time-only UI contract.

- [ ] **Step 1: Write the failing test**

```js
test('new batch scheduling states that the selected time starts production', () => {
  assert.match(source, /自动启动时间/);
  assert.match(source, /不会在此时间直接提交/);
  assert.match(source, /全自动生成并提交（成片完成后上传）/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

Expected: FAIL because the current dialog says only `开始时间` and uses the old run-mode label.

- [ ] **Step 3: Write minimal implementation**

Use `自动启动时间` and add helper text explaining that the scheduler starts production then, while publishing happens after the selected flow completes. Do not modify creation, validation, or scheduling payloads.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

Expected: PASS.

### Task 3: Verify and deliver the V88 change

**Files:**
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`
- Verify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`
- Verify: `frontend`

- [ ] **Step 1: Run focused regression tests**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

Expected: PASS.

- [ ] **Step 2: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: exit code 0.

- [ ] **Step 3: Commit and publish on V88 lineage**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js docs/superpowers/plans/2026-09-24-batch-automation-start-time-copy.md
git commit -m "fix(batch): clarify scheduled automation starts production"
git push origin HEAD:v88
```

- [ ] **Step 4: Deploy the exact V88 SHA and validate the public dialog**

Use the existing incremental V88 direct deployment path with the committed SHA, then inspect the authenticated public `开始定时` dialog. Confirm it says `自动启动时间` and that the helper text states the schedule starts production rather than submitting at that time.
