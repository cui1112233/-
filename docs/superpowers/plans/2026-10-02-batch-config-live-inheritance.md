# Batch Factory Live Model Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make model selection consistent across backend, unified configuration, single-book configuration, presets, and automation while allowing sparse per-book overrides.

**Architecture:** The account model catalogue is the sole source of model IDs, display names, kinds, and enabled state. Automation first applies its selected preset to the batch patch, then each stage reads the live batch patch plus only explicit book differences. Legacy snapshot copies can be repaired only after exact comparison against historical automation state.

**Tech Stack:** Node.js/Express, Go Batch Factory V11 storage bridge, React/Ant Design, Node test runner, Go test runner.

## Global Constraints

- All selectors read the existing typed model catalogue endpoint and label entries as `displayName || name || modelId || id`.
- A book patch includes only real book differences. Equal values are removed through `restoreKeys`.
- New automation has no config snapshot and never writes a complete configuration into a book.
- A missing, disabled, or wrong-kind model is rejected before a provider request.
- Legacy repair is exact-match only and never happens from a page load.
- Do not make paid calls, retry books, alter completed media, deploy, or touch `frontend/dist/downloads/` during implementation.

---

### Task 1: Share model option labels between unified and book configuration

**Files:**
- Modify: `frontend/src/shared/api/modelCatalog.js`
- Create: `frontend/src/shared/api/modelCatalog.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

**Interfaces:**
- Produce `modelSelectOptions(models, kind)`, returning typed `{ value, label }` options.
- Guarantee a record with `displayName: '后台文本模型'` and `name: '旧名'` shows as `后台文本模型` in both dialogs.

- [ ] **Step 1: Write the failing shared-helper test**

```js
test('uses backend displayName for typed model choices', () => {
  assert.deepEqual(modelSelectOptions([
    { id: 'text-a', kind: 'text', displayName: '后台文本模型', name: '旧名' },
    { id: 'video-a', kind: 'video', name: '后台视频模型' }
  ], 'text'), [{ value: 'text-a', label: '后台文本模型' }]);
});
```

- [ ] **Step 2: Verify it fails**

Run: `node --test frontend/src/shared/api/modelCatalog.test.js`  
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add and use the common option mapper**

```js
export function modelSelectOptions(models, kind) {
  return (Array.isArray(models) ? models : [])
    .filter(model => model?.kind === kind && String(model?.id || '').trim())
    .map(model => ({
      value: model.id,
      label: model.displayName || model.name || model.modelId || model.id
    }));
}
```

Replace both local model mappers. Retain their existing fetch, loading, and error behavior.

- [ ] **Step 4: Cover and verify**

Update the book-dialog source test to require the helper and reject its old `item.name || item.id` label mapper. Remove frozen-preset wording assertions.

Run: `node --test frontend/src/shared/api/modelCatalog.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/modelCatalog.js frontend/src/shared/api/modelCatalog.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
git commit -m "fix(batch-factory): unify model dropdown labels"
```

### Task 2: Change automation from frozen snapshots to live inheritance

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `lib/batch-factory-v11/automation-orchestrator.test.js`
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Change `effectiveSettings(batch, book)` to read live batch settings and sparse book overrides.
- Remove `configSnapshot` and `applyExecutionSnapshot` from new-job execution.
- Replace `frozenGiantAutomationRecovery` with `liveGiantAutomationRecovery`.

- [ ] **Step 1: Write failing live-inheritance tests**

```js
test('reads a later batch model change for an inheriting book', () => {
  assert.equal(effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-new' } } },
    { settingsState: { patch: {} } }
  ).textModelId, 'text-new');
});

test('keeps an explicit book model over the batch default', () => {
  assert.equal(effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-batch' } } },
    { settingsState: { patch: { textModelId: 'text-book' } } }
  ).textModelId, 'text-book');
});
```

Also assert that a stage call receives the current batch model and no adapter snapshot-application call occurs.

- [ ] **Step 2: Verify failure**

Run: `node --test lib/batch-factory-v11/automation-orchestrator.test.js`  
Expected: FAIL because `job.configSnapshot` currently wins and is copied into book patches.

- [ ] **Step 3: Implement live-only settings**

```js
function effectiveSettings(batch, book) {
  const batchPatch = object(batch?.settingsState?.patch);
  const bookPatch = object(book?.settingsState?.patch);
  return {
    ...batchPatch,
    ...bookPatch,
    publishSettings: { ...object(batchPatch.publishSettings), ...object(bookPatch.publishSettings) }
  };
}
```

Delete the snapshot configuration stage in `advanceBook`, the route adapter method, and snapshot creation in `automation.start`. Retain historical snapshots only for Task 5 repair.

- [ ] **Step 4: Update giant recovery**

The new recovery helper validates saved plan/run timing but starts from current batch settings. It must no longer require a frozen preset record and must not pass a snapshot to the orchestrator.

- [ ] **Step 5: Verify and commit**

Run: `node --test lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js`  
Expected: PASS.

```bash
git add lib/batch-factory-v11/automation-orchestrator.js lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.js routes/batch-factory-v11.test.js
git commit -m "fix(batch-factory): inherit live batch settings in automation"
```

### Task 3: Persist the selected automation preset as unified configuration

**Files:**
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`
- Modify: `routes/batch-factory-v12.js`
- Modify: `routes/batch-factory-v12.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

**Interfaces:**
- Produce `applyAutomationPresetToBatch({ username, isOwner, batch, preset, bridgeOptions })`.
- Change giant creation to `buildGiantBatchCreatePayload` with initial settings equal to preset config, without a frozen metadata object.

- [ ] **Step 1: Write failing route tests**

```js
test('automation start writes the selected preset to batch settings before queueing', async () => {
  const calls = [];
  // Existing route test fixtures return batch revision 7 from the GET bridge.
  // Record each bridge request in calls, invoke the route, then assert:
  // calls[0] is GET batch, calls[1] is PUT settings with expectedRevision 7
  // and textModelId text-preset, and controller.start follows calls[1].
});
```

```js
assert.deepEqual(buildGiantBatchCreatePayload({ title: '巨量测试', giantAutomation: {
  presetId: 'preset-1', expectedPresetVersion: 3, runMode: 'full_submit', concurrency: 2
}}, { id: 'preset-1', version: 3, config: { textModelId: 'text-preset' } }), {
  title: '巨量测试',
  initialBatchSettings: { textModelId: 'text-preset' },
  giantAutomationPlan: { presetId: 'preset-1', runMode: 'full_submit', concurrency: 2, scheduledAt: '' }
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js`  
Expected: FAIL because current code only captures a snapshot.

- [ ] **Step 3: Implement batch preset application**

Read the batch, remove obsolete `automationPresetSnapshot` from current/preset data, merge nested `aiPromptConfig` and `publishSettings` with existing semantics, PUT revision-checked batch settings, reload the batch, and only then start automation. Apply the same sanitizer in V12 giant intake. Remove client checks and alerts that require frozen metadata.

- [ ] **Step 4: Verify and commit**

Run: `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`  
Expected: PASS.

```bash
git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js routes/batch-factory-v12.js routes/batch-factory-v12.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
git commit -m "fix(batch-factory): apply automation preset to unified settings"
```

### Task 4: Validate model IDs before saving or calling a provider

**Files:**
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`
- Modify: `routes/batch-factory-v12.js`
- Modify: `routes/batch-factory-v12.test.js`

**Interfaces:**
- Produce `validateBatchFactoryModelPatch(input)`.
- Map `textModelId` to text, `imageModelId` to image, and `videoModelId` to video.
- Reject with readable HTTP 422 before saving or a provider request.

- [ ] **Step 1: Write failing validation tests**

```js
test('rejects an unavailable text model before saving', () => {
  assert.throws(() => validateBatchFactoryModelPatch({
    username: 'alice', patch: { textModelId: 'old-text' },
    configReader: () => ({ modelCatalog: [] })
  }), /文本模型不可用、未配置或尚未启用/);
});
```

Add wrong-kind and V12 batch/book write-path cases, plus a stage case proving failed validation makes no external call.

- [ ] **Step 2: Verify failure**

Run: `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js`  
Expected: FAIL because generic settings writes currently bypass the Node catalogue.

- [ ] **Step 3: Implement one validation boundary**

Validate every nonempty mapped ID with `resolveRuntimeModel`. Add explicit V12 settings and book-override handlers before its proxy, validate and then forward unchanged payload through `v11JSONRequest`. Reuse the helper in start and stage dispatch. Missing book fields remain inherited and are not validated as overrides.

- [ ] **Step 4: Verify and commit**

Run: `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js`  
Expected: PASS.

```bash
git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js routes/batch-factory-v12.js routes/batch-factory-v12.test.js
git commit -m "fix(batch-factory): validate selected model catalogue entries"
```

### Task 5: Repair only proven legacy automatic copies

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`
- Modify: `lib/batch-factory-v11/automation-orchestrator.test.js`
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`

**Interfaces:**
- Produce `legacyConfigSnapshot({ owner, batchId })`.
- Produce `repairLegacyExecutionOverrides({ owner, isOwner, batch, snapshot, bridgeOptions })`.
- Add authenticated endpoint `POST /batches/:batchId/automation/repair-legacy-overrides`.

- [ ] **Step 1: Write failing exact-match tests**

```js
test('removes copied fields but preserves a real book model choice', async () => {
  const result = await repairLegacyExecutionOverrides({
    batch: { books: [
      { id: 'copied', settingsState: { patch: { textModelId: 'text-old', videoModelId: 'video-old' } } },
      { id: 'manual', settingsState: { patch: { textModelId: 'text-custom' } } }
    ]},
    snapshot: { textModelId: 'text-old', videoModelId: 'video-old' }
  });
  assert.deepEqual(result.repairedBookIds, ['copied']);
  assert.deepEqual(result.skippedBookIds, ['manual']);
});
```

Cover missing snapshots, differing nested `publishSettings` and `aiPromptConfig`, conflict retry, and idempotency.

- [ ] **Step 2: Verify failure**

Run: `node --test lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js`  
Expected: FAIL because the repair API is absent.

- [ ] **Step 3: Implement conservative repair**

Expose old snapshot state only for repair. Compare known inherited root fields and whole nested configuration values; issue sparse `restoreKeys` only for exact values. Skip missing snapshots, mismatches, and unresolved conflicts. Invoke once before an explicit new automation start, never from page load.

- [ ] **Step 4: Add a non-UI API wrapper**

```js
export function repairLegacyAutomationOverrides(batchId) {
  return apiRequest(bf11Path('batches/' + id(batchId) + '/automation/repair-legacy-overrides'), {
    method: 'POST', body: body({})
  });
}
```

Do not add provenance badges, frozen labels, or a second model list.

- [ ] **Step 5: Verify and commit**

Run: `node --test lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js`  
Expected: PASS.

```bash
git add lib/batch-factory-v11/automation-orchestrator.js lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.js routes/batch-factory-v11.test.js frontend/src/shared/api/batchFactoryV11.js
git commit -m "fix(batch-factory): repair copied legacy book overrides"
```

### Task 6: Verify without external production activity

- [ ] **Step 1: Run targeted Node tests**

```bash
node --test frontend/src/shared/api/modelCatalog.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js lib/batch-factory-v11/automation-orchestrator.test.js routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js
```

Expected: PASS.

- [ ] **Step 2: Build and test backend**

Run: `npm --prefix frontend run build && (cd backend && go test ./...)`  
Expected: successful build and tests; separately report unrelated failures.

- [ ] **Step 3: Inspect final scope**

```bash
git status --short
git diff --check HEAD~5..HEAD
git log --oneline -6
```

Expected: only this feature and documentation are committed; generated downloads remain untracked and untouched.
