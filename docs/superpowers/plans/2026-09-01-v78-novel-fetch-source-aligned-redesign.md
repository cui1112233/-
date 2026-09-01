# V78 小说获取 · 源文件对齐重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `feat/v78-novel-fetch-v2-completion` 上，把已确认的 V78 小说获取重构落地：AI1~AI5 稀疏独立目标、断点续跑、按真实完成版本提交 121、软停止/已取消、当前批次与历史批次，以及保持 V78 既有语言与任务页完整交互。

**Architecture:** 保留现有 `frontend/public/batch-rewrite/` 兼容工作台和 `/api/batch-rewrite` 路由，不另造新前端应用。后端增加一个小型 `target-versions` 领域模块作为新版目标版本的唯一归一化入口；`tasks/runner/rewrite/task-ops/121-web-submit-service/routes` 只消费这个契约。旧任务继续从 `aiCount + 实际文件` 兼容推导，不批量迁移历史数据。

**Tech Stack:** Node.js, Express 5, Node `node:test`, MySQL workshop store, V78 static iframe workbench (`frontend/public/batch-rewrite`).

**Spec:** `docs/superpowers/specs/2026-09-01-v78-novel-fetch-source-aligned-redesign.md`

## Global Constraints

- 工作分支固定：`feat/v78-novel-fetch-v2-completion`。
- 当前实施基线 HEAD：`27604caf990213cdb99b0d90153929cee075c611`；每次写入前重新确认分支未被外部推进。
- UI 文案、按钮名、字段名、状态词优先沿用 V78 现有小说获取：`处理`、`任务`、`刷新`、`重试选中`、`重试失败`、`提交网络`、`进入批量工厂`、`平台`、`解析`、`推送日期`、`风格`、`男女频`、`AI判断`、`原文`、`AI文案`、`网站提交`、`状态`、`操作`。
- 121 登录继续使用“账号名 + 蓝/红状态点；点击账号名弹登录验证框”，不新增第二套登录页。
- 不新增第二套 121 上传版本选择；任务创建时的目标版本决定任务跟踪版本，`提交网络` 只提交已完成且未 confirmed 的目标版本。
- 选定平台后按该平台抓取，不增加跨平台 fallback。
- 真实产物 + 完成记录是断点恢复权威；最后一条日志不能迫使已完成步骤重做。
- `已取消` 不属于 `重试失败` 的自动范围，但允许用户手动勾选后 `重试选中`。
- 未选择的 AI 槽位不生成、不显示为缺口、不重试、不提交。
- 不触碰 Batch Factory V11、生产 `:3000`、生产卷或生产 MySQL。

---

### Task 1: 建立目标版本领域契约并持久化到任务

**Files:**
- Create: `lib/novel-fetch-workshop/target-versions.js`
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Modify: `lib/novel-fetch-workshop/mysql-store.js`
- Test: `tests/novel-fetch-target-versions.test.js`
- Test: `tests/novel-fetch-mysql-fetch-contract.test.js`

**Interfaces:**
- Produces `normalizeTargetVersions(value, legacyAiCount)` → ordered unique subset of `['original','ai1','ai2','ai3','ai4','ai5']`.
- Produces `targetAiIndexes(task)` → integer array, e.g. `[1,3,5]`.
- Produces `deriveLegacyTargetVersions(task, existingAiVersions)` for old tasks lacking `targetVersions`.
- Produces `effectiveTargetVersions(task, existingAiVersions)` as the only compatibility entry point.
- Task meta gains `targetVersions`, `aiSlotMethodsSnapshot`, `batchId`, `batchSettingsSnapshot`, `cancelRequestedAt`, `cancelledAt` without removing `aiCount`.

- [ ] **Step 1: Write failing target-version contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTargetVersions,
  targetAiIndexes,
  effectiveTargetVersions
} = require('../lib/novel-fetch-workshop/target-versions');

test('稀疏版本保持原文和 AI 槽位顺序且去重', () => {
  assert.deepEqual(
    normalizeTargetVersions(['ai5', 'original', 'ai1', 'ai3', 'ai1']),
    ['original', 'ai1', 'ai3', 'ai5']
  );
});

test('选择 AI3 不隐含 AI1/AI2', () => {
  assert.deepEqual(targetAiIndexes({ targetVersions: ['ai3'] }), [3]);
});

test('旧任务无 targetVersions 时兼容 aiCount', () => {
  assert.deepEqual(effectiveTargetVersions({ aiCount: 3 }, []), ['original', 'ai1', 'ai2', 'ai3']);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/novel-fetch-target-versions.test.js`
Expected: FAIL because `target-versions.js` does not exist.

- [ ] **Step 3: Implement the pure target-version module**

Implement exact allowed values, canonical ordering, legacy `aiCount` fallback, and `targetAiIndexes`. Do not infer unselected sparse slots from the highest selected index.

- [ ] **Step 4: Persist new fields without breaking legacy meta**

In both filesystem/MySQL task stores, allow the new fields to round-trip. `saveTasks` must preserve an existing `targetVersions` snapshot unless the caller explicitly supplies a new array for a newly-created/re-run task. Existing `aiCount` remains readable for old API compatibility.

- [ ] **Step 5: Run focused tests GREEN**

Run: `node --test tests/novel-fetch-target-versions.test.js tests/novel-fetch-mysql-fetch-contract.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: persist novel fetch target versions`

---

### Task 2: 让 AI 生成与重试真正按稀疏槽位断点执行

**Files:**
- Modify: `lib/novel-fetch-workshop/rewrite.js`
- Modify: `lib/novel-fetch-workshop/runner.js`
- Modify: `lib/novel-fetch-workshop/task-ops.js`
- Modify: `routes/batch-rewrite.js`
- Test: `tests/novel-fetch-target-versions.test.js`
- Test: `tests/novel-fetch-runner.test.js`
- Test: `tests/novel-fetch-runner-advanced.test.js`
- Test: `tests/novel-fetch-task-ops.test.js`

**Interfaces:**
- Add `generateAiTargets({ ..., aiIndexes })` or extend `generateAiVersions` with explicit `aiIndexes`; callers must pass sparse indexes when `targetVersions` exists.
- `runner` computes pending target AI indexes by checking actual `tasks.readVersionText(username, bookId, 'aiN')` content before generation.
- Retry selection distinguishes manual `selected` from automatic abnormal scope; cancelled tasks are excluded from abnormal retry.

- [ ] **Step 1: Add failing sparse-generation tests**

```js
test('目标 AI1+AI3 只调用两个槽位并保留各自方案', async () => {
  const calls = [];
  // mock chatCompletion pushes ai index/method into calls
  // task.targetVersions = ['ai1', 'ai3']
  // assert calls indexes are [1, 3], never 2
});

test('AI1 已有真实文件时重试只补 AI3', async () => {
  // task.targetVersions = ['ai1','ai3']
  // readVersionText(ai1) returns non-empty, ai3 empty
  // assert generate only ai3
});
```

- [ ] **Step 2: Run focused tests RED**

Run: `node --test tests/novel-fetch-target-versions.test.js tests/novel-fetch-runner.test.js tests/novel-fetch-task-ops.test.js`
Expected: new sparse assertions FAIL while existing tests remain informative.

- [ ] **Step 3: Implement sparse generation**

Use explicit indexes from `targetAiIndexes(task)`. `methodForAiIndex` continues reading `ai_slot_methods['aiN']`; when a batch snapshot exists, prefer `task.aiSlotMethodsSnapshot`, otherwise use current config for old tasks.

- [ ] **Step 4: Implement checkpoint continuation**

Before fetch/generate/submit stages, inspect actual artifacts and confirmed records. Do not redo original if processed original exists; do not redo an AI slot with a non-empty version file. Never treat an unselected AI slot as pending.

- [ ] **Step 5: Correct retry-failed scope**

Automatic retry includes failed/timeout/interrupted/incomplete/121 abnormal states but excludes `cancelled/已取消`. Manual selected retry may include cancelled and clears cancellation request before resuming.

- [ ] **Step 6: Run focused tests GREEN**

Run: `node --test tests/novel-fetch-target-versions.test.js tests/novel-fetch-runner.test.js tests/novel-fetch-runner-advanced.test.js tests/novel-fetch-task-ops.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: run sparse ai targets from checkpoints`

---

### Task 3: 对齐“提交网络”——选任务后上传所有已完成目标版本

**Files:**
- Modify: `lib/novel-fetch-workshop/121-web-submit-service.js`
- Modify: `routes/batch-rewrite.js`
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Test: `tests/novel-fetch-121-web-service.test.js`
- Test: `tests/batch-rewrite-v2-router.test.js`
- Test: `tests/novel-fetch-upload-source-contract.test.js`

**Interfaces:**
- `build...submit...plan` receives task meta and derives versions from `effectiveTargetVersions`.
- Ready version = target version whose source text/file is non-empty.
- Pending submit version = ready target version not already confirmed.
- Existing V78 `提交网络` remains selected-task scoped; no extra version selector is required for execution.

- [ ] **Step 1: Add failing submission-plan tests**

```js
test('目标原文+AI1+AI3，AI3 未完成时只计划原文和 AI1', async () => {
  // source exists for original/ai1; ai3 empty
  // assert planned versions === ['original','ai1']
});

test('再次提交跳过 confirmed，只补后来完成的 AI3', async () => {
  // original/ai1 confirmed, ai3 now ready
  // assert planned versions === ['ai3']
});
```

- [ ] **Step 2: Run submission tests RED**

Run: `node --test tests/novel-fetch-121-web-service.test.js tests/batch-rewrite-v2-router.test.js`
Expected: new target-version assertions FAIL.

- [ ] **Step 3: Replace execution-time `submit_versions` authority**

Keep old config readable for compatibility/profile bindings, but the task's target versions become execution authority for new tasks. Do not silently fall back to AI1 when a new task has an explicit target set.

- [ ] **Step 4: Preserve V78 status semantics**

Continue exposing `已提交 / 上传中 / 排队中 / 待确认 / 失败` and keep historical failure logs even after later success. Confirmed status wins as current status for that version.

- [ ] **Step 5: Run focused tests GREEN**

Run: `node --test tests/novel-fetch-121-web-service.test.js tests/batch-rewrite-v2-router.test.js tests/novel-fetch-upload-source-contract.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: submit completed target versions to 121`

---

### Task 4: 软停止、已取消、当前批次与历史批次后端

**Files:**
- Create: `lib/novel-fetch-workshop/batches.js`
- Modify: `lib/novel-fetch-workshop/queue.js`
- Modify: `lib/novel-fetch-workshop/queue-store.js`
- Modify: `lib/novel-fetch-workshop/task-ops.js`
- Modify: `routes/batch-rewrite.js`
- Test: `tests/novel-fetch-batches.test.js`
- Test: `tests/novel-fetch-queue.test.js`
- Test: `tests/batch-rewrite-queue-api.test.js`

**Interfaces:**
- `batches.create(username, { inputSnapshot, settingsSnapshot, taskIds, sourceBatchId })` returns immutable batch record.
- `batches.current(username)` returns last current batch after reload/login.
- `batches.list(username)` returns history newest first.
- `batches.prepareRerun(username, batchId, mode)` returns original input/settings plus preselected task IDs; it does not start execution.
- Queue/task stop request is soft: current in-flight step may settle/save, then no next stage starts; affected task ends `cancelled`/V78 visible text `已取消`.

- [ ] **Step 1: Write failing batch persistence and stop tests**

```js
test('current batch survives store recreation and old current becomes history', async () => {
  // create batch A, recreate store, assert current A; create B, assert A remains in list
});

test('异常重跑不自动选择 cancelled', async () => {
  // failed + cancelled + timeout -> preselected failed/timeout only
});

test('soft stop lets in-flight stage finish but blocks the next stage', async () => {
  // runner stage resolves after stop request; assert artifact saved and next stage not called
});
```

- [ ] **Step 2: Run tests RED**

Run: `node --test tests/novel-fetch-batches.test.js tests/novel-fetch-queue.test.js tests/batch-rewrite-queue-api.test.js`
Expected: batch module missing/new stop assertions FAIL.

- [ ] **Step 3: Implement batch store**

Persist under the existing per-user workshop storage convention. Batch records are append-only snapshots; rerun produces load data, never overwrites the source batch.

- [ ] **Step 4: Implement both stop scopes**

- Processing page API: stop current batch.
- Task page API: stop selected task IDs only.
- Mark `cancelRequestedAt`; after the currently executing step settles, prevent later stages and write `status='cancelled'`, `cancelledAt`.

- [ ] **Step 5: Add current/history/rerun routes**

Expose minimal authenticated endpoints under `/api/batch-rewrite`, keeping V78 naming in visible responses. Rerun endpoints return a payload to repopulate the processing page; they do not execute automatically.

- [ ] **Step 6: Run focused tests GREEN**

Run: `node --test tests/novel-fetch-batches.test.js tests/novel-fetch-queue.test.js tests/batch-rewrite-queue-api.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: persist novel fetch batches and soft cancel`

---

### Task 5: V78 语言不变地改造处理页和任务页

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/public/batch-rewrite/styles.css`
- Test: `tests/batch-rewrite-flow-ui.test.js`
- Test: `tests/novel-fetch-v2-ui.test.js`
- Test: `tests/novel-fetch-v2-task-list-bridge.test.js`

**Interfaces:**
- Processing input remains `平台 / 输入格式 / 列顺序预设 / 自定义列顺序`.
- New per-run target controls use visible labels `原文 / AI1 / AI2 / AI3 / AI4 / AI5`; each AI line shows its existing “AI文案处理优先方案”.
- 121 login element stays `#webLoginStatus`; blue/red dot behavior and click-to-login dialog remain unchanged.
- Task table keeps full V78 columns and adds explicit `推送日期`.
- `提交网络` remains the selected-task action.

- [ ] **Step 1: Write failing source/UI contract tests**

```js
test('处理页保留 V78 文案并提供独立 AI1~AI5 选择', () => {
  // assert HTML contains 处理/任务/提交网络/男女频/AI判断/网站提交
  // assert target version inputs original, ai1..ai5 exist
});

test('任务表包含推送日期且不移除现有完整字段', () => {
  // assert table headers in V78 terms
});

test('未选择 AI 槽位不会由 render helper 输出占位', () => {
  // target ['ai1','ai5'] -> only AI1/AI5 visible
});
```

- [ ] **Step 2: Run UI tests RED**

Run: `node --test tests/batch-rewrite-flow-ui.test.js tests/novel-fetch-v2-ui.test.js tests/novel-fetch-v2-task-list-bridge.test.js`
Expected: new target controls/current batch/history assertions FAIL.

- [ ] **Step 3: Implement parsed-input state and per-run controls**

Preserve raw textarea state. Parse into selectable books, default all checked. `返回编辑` restores the textarea without data loss. Build request payload with `target_versions`/`targetVersions` and slot-method snapshot.

- [ ] **Step 4: Implement current batch lightweight view**

Below the processing workspace show the current batch only, with `刷新 / 停止处理 / 查看 / 查看全部任务`. Do not add retry/submit/delete there.

- [ ] **Step 5: Keep task page complete and target-aware**

Task AI display shows only selected slots. `网站提交` continues current V78 status wording. Keep `重试选中 / 重试失败 / 提交网络 / 进入批量工厂 / 规则处理 / 删除` in the task center. Add `停止选中` without renaming existing actions.

- [ ] **Step 6: Add history inside 任务, not as a new top-level tab**

Use `当前任务 / 历史批次` as an internal switch. `全部重跑 / 重跑异常` load processing state for confirmation and do not auto-start.

- [ ] **Step 7: Keep 121 login UI untouched**

Do not rename `#webLoginStatus`, do not add a second login/settings card, and keep account name + blue/red dot click behavior.

- [ ] **Step 8: Run UI tests GREEN**

Run: `node --test tests/batch-rewrite-flow-ui.test.js tests/novel-fetch-v2-ui.test.js tests/novel-fetch-v2-task-list-bridge.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: align novel fetch workbench with target versions`

---

### Task 6: 全量回归、兼容检查与验收证据

**Files:**
- Modify only if a test exposes a real regression.
- Test: all `tests/novel-fetch-*.test.js`, `tests/batch-rewrite-*.test.js`, plus frontend build.

**Interfaces:**
- No new feature interfaces. This task verifies Tasks 1–5 and V78 backward compatibility.

- [ ] **Step 1: Run all novel-fetch and batch-rewrite Node tests**

Run:

```bash
node --test tests/novel-fetch-*.test.js tests/batch-rewrite-*.test.js tests/121-browser-*.test.js
```

Expected: PASS with zero failing tests.

- [ ] **Step 2: Run frontend build**

Run: `npm --prefix frontend run build`
Expected: successful Vite build with no compile errors.

- [ ] **Step 3: Run static source checks for forbidden regressions**

Verify:
- no new top-level `121` tab;
- `提交网络` still exists in task page;
- `webLoginStatus` still exists and click handler opens login dialog;
- task headers still include V78 terms;
- sparse target functions never expand `ai3` to `ai1..ai3`.

- [ ] **Step 4: Review branch diff against spec**

Compare all changed files with `docs/superpowers/specs/2026-09-01-v78-novel-fetch-source-aligned-redesign.md`. Pay special attention to 121 behavior, cancellation semantics, history rerun vs task retry, and V78 wording.

- [ ] **Step 5: Commit final fixes if any**

Commit message if needed: `fix: complete source-aligned novel fetch regression pass`

- [ ] **Step 6: Record final HEAD and verification commands**

Report the final branch SHA and exact commands/results; do not claim completion unless tests/build have actually passed.
