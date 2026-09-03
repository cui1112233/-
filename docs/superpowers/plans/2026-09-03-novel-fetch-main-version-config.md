# Novel Fetch Mainline Version Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小说获取主线页面的旧“解析输入”入口改为可弹出的“版本对应配置档”卡片，使用户输入小说后可以直接开始处理，并能先同步 121 配置档和风格类型、绑定原文与 AI1～AI5 后执行。

**Architecture:** `/novel-fetch` 继续使用主线 React 外壳，实际工作区继续由 `/batch-rewrite/index.html` 提供。前端把版本选择、AI 槽位处理方式和 121 配置档绑定保存到请求及任务元数据，后端使用同一组选中版本生成和提交，避免处理与上传各维护一套版本选择。只回迁小说获取相关改动，不整体合并集成分支的无关提交。

**Tech Stack:** Node.js CommonJS、Express、原生 HTML/CSS/JavaScript、Node `node:test`、GitHub Contents API。

**Spec:** `docs/superpowers/specs/2026-09-03-novel-fetch-main-version-config-design.md`

## Global Constraints

- `/novel-fetch` 保留主线 React 外壳，工作区仍来自 `/batch-rewrite/index.html`。
- 书籍清单输入仍保留为任务入口；删除解析按钮、解析格式、列顺序和独立默认 AI 文案数量作为处理主入口。
- 版本顺序固定为 `original, ai1, ai2, ai3, ai4, ai5`。
- AI 槽位方法只允许 `high_imitation`、`opening_instruction`、`instruction` 或空值（自动轮换）。
- 版本对应 121 配置档允许逐版本绑定；空值按默认配置档或书籍平台、男女频、风格自动匹配。
- “同步批量后台配置”调用 121 配置同步接口；“同步批量风格类型”调用 121 风格同步接口；失败时显示同步、登录会话或接口错误原因。
- 旧任务没有显式版本数组时，继续按旧 `aiCount` 推导版本。
- 前端构建产物和源码必须同步更新；发布时前后端必须使用同一个 Git SHA，不能只替换静态文件。

---

### Task 1: Add red tests for the mainline flow

**Files:**
- Create: `tests/novel-fetch-mainline-version-config.test.js`
- Reference: `lib/novel-fetch-workshop/version-selection.js`
- Reference: `frontend/public/batch-rewrite/index.html`
- Reference: `frontend/public/batch-rewrite/app.js`

**Interfaces:**
- Produces executable Node tests for version normalization, legacy compatibility, profile binding, and the public workbench source contract.
- Later tasks make the required module exports and source markers satisfy these tests.

- [ ] **Step 1: Write the failing test**

Create a Node test file with these cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('版本集合固定为原文和 AI1 到 AI5，并保留稀疏选择', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.VERSION_ORDER, ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.deepEqual(selection.normalizeSelectedVersions(['AI5', 'ai1', 'ai5', 'invalid']), ['ai1', 'ai5']);
});

test('旧任务仍能从 aiCount 推导目标版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.taskSelectedVersions({ aiCount: 2 }), ['original', 'ai1', 'ai2']);
});

test('版本对应配置档覆盖原文和 AI1 到 AI5，并丢弃未知版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.normalizeProfileBindings({
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5',
    ai6: 'ignored'
  }), {
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5'
  });
});

test('主线工作区是版本配置入口，不再保留旧解析入口', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');
  for (const label of ['版本对应配置档', '同步批量后台配置', '同步批量风格类型', 'AI5']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /解析格式|列顺序|默认AI文案数量/);
  assert.match(app, /processBtn/);
  assert.match(app, /selected_versions/);
  assert.match(app, /ai_slot_methods/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: FAIL because the mainline branch does not yet expose the six-version selection module and still contains the old parse controls.

- [ ] **Step 3: Commit the red test**

Use commit message:

```text
test(novel-fetch): define mainline version config flow
```

---

### Task 2: Add shared version and profile-selection normalization

**Files:**
- Create: `lib/novel-fetch-workshop/version-selection.js`
- Test: `tests/novel-fetch-mainline-version-config.test.js`

**Interfaces:**
- Produces `VERSION_ORDER`, `DEFAULT_VERSIONS`, `normalizeSelectedVersions(value, fallback)`, `selectedAiIndices(value)`, `normalizeAiSlotMethods(value)`, `normalizeProfileBindings(value)`, `taskSelectedVersions(task)`, and `generatedVersions(task)`.
- Consumes the existing `lib/novel-fetch-workshop/target-versions.js` functions `TARGET_VERSION_ORDER`, `normalizeTargetVersions`, and `legacyTargetVersions`.

- [ ] **Step 1: Extend tests for method normalization**

Add this assertion:

```js
assert.deepEqual(selection.normalizeAiSlotMethods({
  ai1: 'instruction',
  ai2: 'opening_instruction',
  ai5: 'high_imitation',
  ai3: 'invalid',
  ai6: 'instruction'
}), {
  ai1: 'instruction',
  ai2: 'opening_instruction',
  ai5: 'high_imitation'
});
```

- [ ] **Step 2: Run the focused test and verify the new assertion fails**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: FAIL because `normalizeAiSlotMethods` is not exported on the mainline branch.

- [ ] **Step 3: Implement the minimal module**

Implement the following behavior:

```js
const {
  TARGET_VERSION_ORDER,
  normalizeTargetVersions,
  legacyTargetVersions
} = require('./target-versions');

const VERSION_ORDER = TARGET_VERSION_ORDER;
const AI_METHODS = new Set(['high_imitation', 'opening_instruction', 'instruction']);
const DEFAULT_VERSIONS = Object.freeze(['original', 'ai1']);

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeSelectedVersions(value, fallback = DEFAULT_VERSIONS) {
  const requested = asList(value);
  if (requested.length) return normalizeTargetVersions(requested);
  return normalizeTargetVersions(asList(fallback));
}

function selectedAiIndices(value) {
  return normalizeSelectedVersions(value, [])
    .filter(version => /^ai[1-5]$/.test(version))
    .map(version => Number(version.slice(2)));
}

function normalizeAiSlotMethods(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (let index = 1; index <= 5; index += 1) {
    const key = `ai${index}`;
    const method = String(source[key] || '').trim();
    if (AI_METHODS.has(method)) normalized[key] = method;
  }
  return normalized;
}

function normalizeProfileBindings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const version of VERSION_ORDER) {
    const profile = String(source[version] || '').trim();
    if (profile) result[version] = profile;
  }
  return result;
}

function taskSelectedVersions(task = {}) {
  const explicit = task.selectedVersions || task.selected_versions || task.targetVersions || task.target_versions;
  if (Array.isArray(explicit)) return normalizeSelectedVersions(explicit);
  const legacyCount = Math.max(0, Math.min(Number(task.aiCount || task.ai_count) || 0, 5));
  if (legacyCount > 0) return legacyTargetVersions(legacyCount, { includeOriginal: true });
  return [...DEFAULT_VERSIONS];
}

function generatedVersions(task = {}) {
  const explicit = task.aiGeneratedVersions || task.ai_generated_versions;
  if (Array.isArray(explicit)) return normalizeSelectedVersions(explicit, [])
    .filter(version => version !== 'original');
  const legacyCount = Math.max(0, Math.min(Number(task.aiGeneratedCount || task.ai_generated_count) || 0, 5));
  return legacyTargetVersions(legacyCount, { includeOriginal: false });
}

module.exports = {
  VERSION_ORDER,
  DEFAULT_VERSIONS,
  normalizeSelectedVersions,
  selectedAiIndices,
  normalizeAiSlotMethods,
  normalizeProfileBindings,
  taskSelectedVersions,
  generatedVersions
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: PASS for all version and profile normalization cases.

- [ ] **Step 5: Commit**

Use commit message:

```text
feat(novel-fetch): normalize selected versions and profile bindings
```

---

### Task 3: Persist selected versions and AI methods in tasks

**Files:**
- Modify: `lib/novel-fetch-workshop/task-ops.js`
- Modify: `routes/batch-rewrite.js`
- Modify: `lib/novel-fetch-workshop/rewrite.js`
- Modify: `routes/novel-fetch-upload.js`
- Test: `tests/novel-fetch-mainline-version-config.test.js`
- Reference: `lib/novel-fetch-workshop/version-selection.js`

**Interfaces:**
- `setSelectedVersions(owner, ids, selectedVersions, aiSlotMethods)` validates and stores `targetVersions`, `selectedVersions`, `aiSlotMethodsSnapshot`, `aiSlotMethods), and the derived AI count.
- Task API responses expose `selected_versions`, `target_versions`, `ai_slot_methods`, and generated version lists.
- AI generation accepts `versions` and `slotMethods` and writes only selected AI slots.
- Upload selection consumes the same version list and normalized per-version profile bindings.

- [ ] **Step 1: Add failing persistence and sparse-generation tests**

Add these test expectations to the focused test suite:

```js
test('版本处理配置保存后重新读取仍保留选择和槽位方案', async () => {
  const task = { meta: { bookId: 'book-1' } };
  const saved = {};
  const fakeStore = {
    async getTask() { return task; },
    async updateTaskMeta(_owner, _id, patch) { Object.assign(saved, patch); }
  };
  const ops = require('../lib/novel-fetch-workshop/task-ops');
  const factory = ops.createNovelFetchTaskOps;
  assert.equal(typeof factory, 'function');
  assert.deepEqual(saved, {});
});
```

Extend the fake-store case to call `setSelectedVersions` and verify:

```js
assert.deepEqual(saved.targetVersions, ['original', 'ai2', 'ai5']);
assert.deepEqual(saved.aiSlotMethodsSnapshot, {
  ai2: 'opening_instruction',
  ai5: 'instruction'
});
```

- [ ] **Step 2: Run the focused test and verify the persistence test fails**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: FAIL because the mainline task operations do not yet expose the six-slot persistence path.

- [ ] **Step 3: Implement task persistence and route wiring**

Use `normalizeTargetVersions` and `normalizeAiSlotMethods` at task creation and update boundaries. Store the normalized arrays and object in task metadata. On task detail/list, map them back to snake-case API fields. In the AI generation route, pass only selected AI versions and the corresponding slot methods into `generateAiVersions`. In upload routes, normalize profile bindings across `original`, `ai1` through `ai5` and keep the existing default/profile auto-match fallback.

The processing request must accept:

```js
{
  input_text,
  selected_versions: ['original', 'ai2', 'ai5'],
  ai_slot_methods: {
    ai2: 'opening_instruction',
    ai5: 'instruction'
  },
  profile_bindings: {
    original: 'profile-original',
    ai2: 'profile-two',
    ai5: 'profile-five'
  }
}
```

It must reject an empty selected version array with the user-facing error `请至少选择一个文案版本`.

- [ ] **Step 4: Run focused backend tests**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js tests/novel-fetch-rewrite-sparse.test.js tests/batch-rewrite-batches-api.test.js
```

Expected: PASS, with sparse selection generating only the requested AI slots.

- [ ] **Step 5: Commit**

Use commit message:

```text
feat(novel-fetch): persist version selections through processing and upload
```

---

### Task 4: Replace parse controls with the popup version configuration card

**Files:**
- Modify: `frontend/public/batch-rewrite/index.html`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/public/batch-rewrite/styles.css`
- Modify: `frontend/dist/batch-rewrite/index.html`
- Modify: `frontend/dist/batch-rewrite/app.js`
- Modify: `frontend/dist/batch-rewrite/styles.css`
- Test: `tests/novel-fetch-mainline-version-config.test.js`

**Interfaces:**
- Produces a visible `版本对应配置档` trigger, popup card state, six version checkboxes, five AI method selectors, profile binding selectors, sync buttons, close button, and direct `开始处理` action.
- Consumes `/api/web-submit/sync-configs` and `/api/web-submit/sync-styles` through the existing `api()` wrapper.
- `processInput()` sends `selected_versions`, `ai_slot_methods`, and `profile_bindings) directly; no parse-preview request is required before processing.

- [ ] **Step 1: Add failing UI source assertions**

Extend the UI test with these checks:

```js
for (const id of [
  'versionConfigBtn',
  'versionConfigCard',
  'syncWebProfilesBtn',
  'syncWebStylesBtn',
  'webProfileBindingOriginal',
  'webProfileBindingAi5',
  'processBtn'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}
assert.match(app, /openVersionConfigCard/);
assert.match(app, /closeVersionConfigCard/);
assert.match(app, /syncWebSubmit/);
assert.match(app, /selectedProcessVersions/);
assert.doesNotMatch(html, /解析输入|parseModeSelect|columnPresetSelect|columnOrderInput/);
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: FAIL because the mainline HTML and JavaScript still expose the old parse controls and do not contain the popup card.

- [ ] **Step 3: Implement the popup card**

In the original processing settings area:

- Keep the book-list textarea.
- Replace the parse button and parse mode/column controls with a compact trigger labelled `版本对应配置档`.
- Render a modal/card with:
  - original, AI1, AI2, AI3, AI4, AI5 checkboxes;
  - AI1–AI5 method selectors with `自动轮换`, `高仿文章库`, `爆款开头词库`, `批量改文指令库`;
  - default 121 profile selector;
  - original and AI1–AI5 profile selectors;
  - `同步批量后台配置`;
  - `同步批量风格类型`;
  - `保存版本配置`;
  - close control.
- The card must be closable without losing its current selections. Add the popup presentation styles to both public and dist stylesheets so the served page has the same modal behavior.
- Sync success repopulates selectors and keeps existing bindings where profile IDs still exist. Sync failure writes a clear status message and does not silently clear selections.
- `processInput()` validates that at least one version is checked, saves the current version settings, then submits the task request immediately. It must not require a separate parse-preview action.
- The site-submit panel reads the same selected version set and per-version profile bindings.

Use the existing public static page style and event-binding patterns; do not create a second novel-fetch page.

- [ ] **Step 4: Run the UI and source-contract tests**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js tests/batch-rewrite-flow-ui.test.js
```

Expected: PASS, including the absence of the old parse controls and presence of the popup/sync/direct-process contract.

- [ ] **Step 5: Commit**

Use commit message:

```text
feat(novel-fetch): replace parse settings with version config card
```

---

### Task 5: Synchronize built assets and verify the complete flow

**Files:**
- Modify: `frontend/dist/batch-rewrite/index.html`
- Modify: `frontend/dist/batch-rewrite/app.js`
- Modify: `tests/novel-fetch-mainline-version-config.test.js`
- Reference: `frontend/public/batch-rewrite/index.html`
- Reference: `frontend/public/batch-rewrite/app.js`

**Interfaces:**
- The served `frontend/dist` files contain the same version-card and direct-processing behavior as `frontend/public`.
- The final branch can be built and checked using the repository's existing Node/frontend commands.

- [ ] **Step 1: Add built-asset parity assertions**

Add:

```js
const distHtml = fs.readFileSync(path.join(root, 'frontend/dist/batch-rewrite/index.html'), 'utf8');
const distApp = fs.readFileSync(path.join(root, 'frontend/dist/batch-rewrite/app.js'), 'utf8');
assert.match(distHtml, /版本对应配置档/);
assert.match(distHtml, /同步批量后台配置/);
assert.match(distApp, /selected_versions/);
```

- [ ] **Step 2: Run and verify parity assertions fail if dist is stale**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js
```

Expected: FAIL until the served dist assets are updated.

- [ ] **Step 3: Update dist assets from the final public workbench implementation**

Copy the finalized public workbench behavior into the served dist workbench, preserving the existing build output structure and without introducing an alternate page.

- [ ] **Step 4: Run the full verification set**

Run:

```bash
node --test tests/novel-fetch-mainline-version-config.test.js tests/novel-fetch-version-selection.test.js tests/novel-fetch-rewrite-sparse.test.js tests/batch-rewrite-flow-ui.test.js
npm --prefix frontend run build
```

Expected: all focused tests pass and the frontend build exits with code 0.

- [ ] **Step 5: Inspect the final diff and commit**

Confirm only the planned novel-fetch files changed, then use:

```text
test(novel-fetch): verify mainline version config workflow
```

---

### Task 6: Pre-release review and public deployment gate

**Files:**
- Reference: `docs/superpowers/specs/2026-09-03-novel-fetch-main-version-config-design.md`
- Reference: `docs/superpowers/plans/2026-09-03-novel-fetch-main-version-config.md`
- Modify after release SHA is known: production version record

**Interfaces:**
- The final review checks that the implementation and deployment use one exact Git SHA.
- Public validation must cover `/novel-fetch`, `/batch-rewrite/index.html`, `/api/batch-rewrite/config`, configuration sync and task-processing endpoints.

- [ ] **Step 1: Review the final file list against the spec**

Verify no unrelated V88/Go batch-factory files were included and that both public and dist workbenches are updated.

- [ ] **Step 2: Run the release smoke checks**

Check HTTP 200 for `/novel-fetch` and `/batch-rewrite/index.html`; verify the served HTML contains `版本对应配置档`, `同步批量后台配置`, and `AI5`. Verify unauthenticated APIs return their documented auth response rather than a route-not-found response.

- [ ] **Step 3: Request code review before merge**

Provide the review with the base SHA `fc1f5a96364518f0f14073fd5195363ef0e15a77`, the final branch SHA, this plan, and the design spec. Fix critical/important review findings before merging to the official mainline.

- [ ] **Step 4: Publish only after a single-SHA build**

Build frontend and backend from the final SHA, verify the image architecture and checksum, deploy, then re-run the public smoke checks. Do not claim public availability until these checks return the expected results.
