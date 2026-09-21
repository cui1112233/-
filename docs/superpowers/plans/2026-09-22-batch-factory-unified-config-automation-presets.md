# 批量工厂统一配置与自动化预设 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将模型配置、AI 推理和发布统一收敛为一份批量级统一配置，并提供可命名、可管理、可冻结的自动化预设。

**Architecture:** `settingsState.patch` 继续是批量统一配置的唯一持久化对象，单书 `settingsState.patch` 继续只保存显式覆盖。前端将现有引擎、AI 推理和发布编辑区组合进 `BatchFactoryUnifiedSettingsModal`；自动化预设只保存完整批量 patch，载入时先进入统一配置草稿，确认保存后才覆盖批量 patch。定时任务保存预设版本和深拷贝快照。

**Tech Stack:** React、Ant Design、Node.js/Express、node:test、既有 V11/V12 bridge。

## Global Constraints

- 保留现有未提交改动；每项只暂存该项列出的文件。
- `settingsState.patch` 是批量统一配置唯一来源；单书覆盖不得被预设载入或预设 CRUD 改写。
- 自动化预设按账号保存名称、版本、创建时间、更新时间和完整配置快照；不得保存正文、资产、导演或视频结果。
- 开始定时只包含预设、执行模式和时间；不接受或保存任务级并发数。
- 已启动或排期任务继续使用启动时冻结快照，预设和批量配置后续变化不得影响它。
- 用户可见名称统一使用“视频管理系统”。

---

### Task 1: 自动化预设完整快照与账户级管理契约

**Files:**
- Modify: `lib/batch-factory-v11/automation-presets.js`
- Modify: `lib/batch-factory-v11/automation-presets.test.js`
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.test.js`

**Interfaces:**
- Produces `createAutomationPresetStore().create(owner, { name, config })`, `update(owner, id, { name, config, expectedVersion })`, `remove(owner, id)` and `get(owner, id)`.
- Produces browser calls `listAutomationPresets()`, `createAutomationPreset(input)`, `updateAutomationPreset(id, input)`, `deleteAutomationPreset(id)` and `saveBatchAutomationPreset(batchId, name)`.
- `config` is a deep clone of full `batch.settingsState.patch`, including model fields, `aiPromptConfig`, `audioPlanningEnabled`, `storyboardDurationLimit`, `tts`, and `publishSettings`.

- [ ] **Step 1: Write failing preset-store tests**

```js
test('automation preset preserves the complete unified configuration snapshot', async () => {
  const preset = await store.create('alice', { name: '女频 H3', config: fullPatch });
  assert.deepEqual(preset.config, fullPatch);
  fullPatch.publishSettings.organization = 'mutated';
  assert.equal((await store.get('alice', preset.id)).config.publishSettings.organization, 'frozen-org');
});

test('automation preset update requires the selected version', async () => {
  await assert.rejects(store.update('alice', preset.id, { name: 'new', expectedVersion: 99 }), /版本已变化/);
});
```

- [ ] **Step 2: Run the store test and verify the deep-snapshot case fails before implementation**

Run: `node --test lib/batch-factory-v11/automation-presets.test.js`

Expected: FAIL because a complete patch fixture is not yet asserted or the required snapshot behavior is absent.

- [ ] **Step 3: Add the smallest complete-patch validation and clone behavior**

```js
function unifiedPatch(value) {
  const patch = object(value);
  if (!Object.keys(patch).length) throw new Error('自动化预设需要完整统一配置');
  return clone(patch);
}
```

Use `unifiedPatch` in create and update; retain account scoping and optimistic `expectedVersion` checks.

- [ ] **Step 4: Add failing route/API tests for CRUD and save-from-current-batch**

```js
assert.match(apiSource, /updateAutomationPreset/);
assert.match(apiSource, /deleteAutomationPreset/);
assert.deepEqual(saved.preset.config.publishSettings, batch.settingsState.patch.publishSettings);
```

- [ ] **Step 5: Expose the existing CRUD routes through the browser API client and re-run tests**

Run: `node --test lib/batch-factory-v11/automation-presets.test.js routes/batch-factory-v11.test.js frontend/src/shared/api/batchFactoryV11.test.js`

Expected: PASS.

- [ ] **Step 6: Commit Task 1 only**

```bash
git add lib/batch-factory-v11/automation-presets.js lib/batch-factory-v11/automation-presets.test.js routes/batch-factory-v11.js routes/batch-factory-v11.test.js frontend/src/shared/api/batchFactoryV11.js frontend/src/shared/api/batchFactoryV11.test.js
git commit -m "feat(batch-factory): manage full automation presets"
```

### Task 2: 可复用的统一配置编辑器

**Files:**
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryEngineSettingsDrawer.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- `BatchFactoryUnifiedSettingsModal({ open, batch, books, configVersions, onClose, onSaved })` edits one `draftPatch` and calls `onSaved({ patch, expectedRevision })` only from its save action.
- Extract `BatchFactoryEngineSettingsForm` and `BatchFactoryAiReasoningForm`; each receives `{ value, onChange }` and never saves directly.
- The unified modal has three visibly named areas: `模型配置`、`AI 推理`、`发布统一`.

- [ ] **Step 1: Write the failing unified-modal source test**

```js
test('unified configuration owns models, AI reasoning and publication in one editable patch', () => {
  assert.match(source, /模型配置/);
  assert.match(source, /AI 推理/);
  assert.match(source, /发布统一/);
  assert.match(source, /BatchFactoryEngineSettingsForm/);
  assert.match(source, /BatchFactoryAiReasoningForm/);
  assert.match(source, /onSaved\(\{ patch: draftPatch/);
});
```

- [ ] **Step 2: Run the test and verify it fails because the editor does not exist**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

Expected: FAIL with missing file or missing exported editor.

- [ ] **Step 3: Extract save-free engine and AI forms**

```jsx
export function BatchFactoryEngineSettingsForm({ value, onChange }) { /* existing engine fields */ }
export function BatchFactoryAiReasoningForm({ value, books, onChange }) { /* existing AI modules */ }
```

Move only field rendering and local normalization into these forms. Leave existing single-book configuration behavior intact.

- [ ] **Step 4: Implement the unified modal with one draft patch and one save action**

```jsx
const [draftPatch, setDraftPatch] = useState(() => batch?.settingsState?.patch || {});
const save = () => onSaved({ patch: draftPatch, expectedRevision: Number(batch?.settingsState?.revision || 0) });
```

Pass model-related fields to the engine form, `draftPatch.aiPromptConfig` to the AI form, and `draftPatch.publishSettings` to the publish form.

- [ ] **Step 5: Replace the two top-level launchers with one `统一配置` launcher**

```jsx
<Button onClick={() => setUnifiedSettingsOpen(true)}>统一配置</Button>
```

Remove the standalone top-level `AI 推理` launcher. Preserve all per-book buttons and their explicit override behavior.

- [ ] **Step 6: Run editor tests and build**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js && npm run build -- --outDir /private/tmp/batch-factory-unified-settings`

Expected: targeted new test PASS; pre-existing unrelated source-test failures are recorded separately and are not deleted.

- [ ] **Step 7: Commit Task 2 only**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryEngineSettingsDrawer.jsx frontend/src/user/pages/shuihuo/BatchFactoryAiReasoningModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo-production.css
git commit -m "feat(batch-factory): unify production configuration"
```

### Task 3: 统一配置左上角的自动化预设齿轮

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`
- Modify: `frontend/src/user/pages/shuihuo-production.css`

**Interfaces:**
- `AutomationPresetManager({ currentPatch, onLoad })` lists account presets and offers save-as-new, load, rename and delete.
- `onLoad(preset.config)` replaces only modal `draftPatch`; it does not call `saveBatchSettings`.
- Delete and load require explicit confirmation.

- [ ] **Step 1: Write failing interaction/source tests for named save and draft-only load**

```js
test('automation preset manager loads into the unified draft only after confirmation', () => {
  assert.match(source, /自动化预设/);
  assert.match(source, /保存为新预设/);
  assert.match(source, /重命名所选预设/);
  assert.match(source, /删除所选预设/);
  assert.match(source, /确认载入此预设/);
  assert.match(source, /setDraftPatch\(clonePresetConfig/);
  assert.doesNotMatch(loadHandler, /saveBatchSettings/);
});
```

- [ ] **Step 2: Run the test and verify it fails before manager implementation**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`

Expected: FAIL because the manager actions and confirmation boundary are absent.

- [ ] **Step 3: Implement the header-left gear and preset manager**

```jsx
<Tooltip title="自动化预设"><Button aria-label="自动化预设" icon={<SettingOutlined />} onClick={() => setPresetOpen(true)} /></Tooltip>
```

Use `Modal.confirm` before assigning a selected preset to `draftPatch`; use `createAutomationPreset`, `updateAutomationPreset`, and `deleteAutomationPreset` for CRUD; retain a selected loaded preset name but require the main modal save to persist it to the batch.

- [ ] **Step 4: Run preset UI test and build**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js && npm run build -- --outDir /private/tmp/batch-factory-preset-manager`

Expected: PASS.

- [ ] **Step 5: Commit Task 3 only**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo-production.css
git commit -m "feat(batch-factory): load named automation presets"
```

### Task 4: 定时仅选择预设并冻结版本

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`
- Modify: `test/batch-factory-automation.test.js`
- Modify: `routes/batch-factory-v11.js`
- Modify: `lib/batch-factory-v11/automation-orchestrator.js`

**Interfaces:**
- `startBatchAutomation(batchId, { presetId, runMode, scheduledAt })` accepts no preset-creation or patch-editing fields.
- Job state stores `{ preset: { id, name, version }, configSnapshot }`; `configSnapshot` is immutable after `start`.
- Effective runtime settings are `configSnapshot` merged with the book’s own override patch.

- [ ] **Step 1: Write failing controller tests for an old preset version and single-book override priority**

```js
test('scheduled job retains the selected preset version after preset update', async () => {
  await controller.start({ owner: 'alice', batchId: 'b1', preset: { id: 'p1', version: 1 }, configSnapshot: { videoModelId: 'v1' } });
  await presetStore.update('alice', 'p1', { name: 'new', config: { videoModelId: 'v2' }, expectedVersion: 1 });
  assert.equal(controller.status({ owner: 'alice', batchId: 'b1' }).configSnapshot.videoModelId, 'v1');
});

test('book override wins over a frozen unified preset field', () => {
  assert.equal(effectiveVideoModel({ videoModelId: 'preset' }, { videoModelId: 'book' }), 'book');
});
```

- [ ] **Step 2: Run the controller test and verify the immutability or priority case fails**

Run: `node --test test/batch-factory-automation.test.js`

Expected: FAIL until the test uses the same freeze path as the live route and proves no live replacement occurs.

- [ ] **Step 3: Remove preset creation controls from `开始定时` and retain only select, mode and time**

```jsx
<Select placeholder="选择已保存预设" value={automationPresetID || undefined} onChange={setAutomationPresetID} />
<Select value={automationRunMode} onChange={setAutomationRunMode} />
<Input type="datetime-local" value={automationScheduledAt} onChange={event => setAutomationScheduledAt(event.target.value)} />
```

Require a selected preset before start. The user creates and edits presets only from the unified configuration gear.

- [ ] **Step 4: Preserve route and controller snapshot behavior and run regressions**

Run: `node --test test/batch-factory-automation.test.js routes/batch-factory-v11.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: automation freeze and mode tests PASS; unrelated historical UI tests remain reported, not removed.

- [ ] **Step 5: Commit Task 4 only**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js test/batch-factory-automation.test.js routes/batch-factory-v11.js lib/batch-factory-v11/automation-orchestrator.js
git commit -m "fix(batch-factory): schedule frozen automation presets"
```

### Task 5: 浏览器和本地运行时验收

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-batch-factory-unified-config-automation-presets-design.md`
- Modify: `docs/superpowers/plans/2026-09-22-batch-factory-unified-config-automation-presets.md`

- [ ] **Step 1: Verify the new workbench flow without submitting production tasks**

Use the local `http://127.0.0.1:5173/shuihuo-production` workbench and verify:

1. The toolbar has one `统一配置` entry and no standalone `AI 推理` entry.
2. The unified configuration modal contains model, AI reasoning and publication areas.
3. The header-left gear opens preset management.
4. A named preset can be saved, then loaded into draft, without changing a single-book override before unified save.
5. `自动生产 → 开始定时` contains only preset, mode and time.

- [ ] **Step 2: Run final automated verification**

Run: `node --test lib/batch-factory-v11/automation-presets.test.js routes/batch-factory-v11.test.js test/batch-factory-automation.test.js && node --test frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js && npm --prefix frontend run build -- --outDir /private/tmp/batch-factory-unified-final && go test ./internal/batchfactoryv11 ./internal/httpapi`

Expected: new/targeted tests, build and H3 backend tests PASS. List unrelated pre-existing source-test failures explicitly if still present.

- [ ] **Step 3: Commit acceptance documentation only**

```bash
git add docs/superpowers/specs/2026-09-22-batch-factory-unified-config-automation-presets-design.md docs/superpowers/plans/2026-09-22-batch-factory-unified-config-automation-presets.md
git commit -m "docs(batch-factory): verify unified configuration presets"
```

## Plan self-review

- Spec coverage: Task 1 implements versioned account presets; Tasks 2 and 3 implement the single unified editor and header-left manager; Task 4 keeps schedule freeze and single-book precedence; Task 5 proves the visible flow and H3 regressions.
- Placeholder scan: every task includes exact files, interfaces, test commands and a bounded implementation action.
- Type consistency: the complete batch patch remains `config`, the unified modal uses `draftPatch`, scheduled work persists `configSnapshot`, and single-book changes remain `book.settingsState.patch`.
