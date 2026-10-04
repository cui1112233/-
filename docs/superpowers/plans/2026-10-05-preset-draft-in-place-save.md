# 系统预设词草稿原地保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许系统预设词草稿原地保存，只有明确另存时才创建新版本。

**Architecture:** `preset-store` 负责不可变已发布版本和可变草稿的状态机；`admin` 路由将模块权限和并发版本传给存储层；管理台根据当前记录状态选择保存或另存接口。

**Tech Stack:** Node.js、Express、node:test、React、Ant Design。

## Global Constraints

- 以 `v88` 为唯一源码基线，不直接修改公网运行文件。
- 草稿可更新，已发布与归档版本不可更新。
- 只有显式另存操作可创建下一版本；发布仍必须由管理员单独确认。
- 更新使用 `expectedRevision`，防止陈旧编辑器覆盖现有草稿。

---

### Task 1: 草稿状态机与审计

**Files:**
- Modify: `lib/preset-store.js`
- Create: `lib/preset-store.test.js`

**Interfaces:**
- Produces: `updateDraft(actor, id, version, input)`，成功返回公开预设；非草稿抛出 `CONFLICT`。

- [ ] **Step 1: Write the failing test**

```js
test('updates a draft in place without creating another version', () => {
  const created = store.createDraft('admin', draftBody('first'));
  const updated = store.updateDraft('admin', created.id, created.version, {
    ...draftBody('second'), expectedVersion: created.version
  });
  assert.equal(updated.version, 1);
  assert.equal(store.listAll('batch-factory').length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/preset-store.test.js`

Expected: FAIL because `updateDraft` does not exist.

- [ ] **Step 3: Write minimal implementation**

Add validated `updateDraft`, allow `preset.draft_updated` in audit validation, preserve draft creation metadata, and atomically persist the updated state.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/preset-store.test.js`

Expected: PASS.

### Task 2: 管理端接口与权限

**Files:**
- Modify: `routes/admin.js`
- Modify: `frontend/src/shared/api/admin.js`
- Create: `routes/admin.test.js`

**Interfaces:**
- Consumes: `presetStore.updateDraft(actor, id, version, input)`。
- Produces: `PUT /api/admin/presets/:id/:version/draft`。

- [ ] **Step 1: Write the failing test**

```js
test('PUT draft endpoint updates only the selected draft version', async () => {
  const response = await request.put('/api/admin/presets/batch-video-sd/3/draft')
    .send({ ...draftBody('changed'), expectedVersion: 3 });
  assert.equal(response.status, 200);
  assert.equal(response.body.preset.version, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test routes/admin.test.js`

Expected: FAIL because the update route does not exist.

- [ ] **Step 3: Write minimal implementation**

Register the route after the draft creation route, load the target preset for module permission, reject mismatched request IDs, and delegate to `updateDraft`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test routes/admin.test.js`

Expected: PASS.

### Task 3: 管理台保存与另存分流

**Files:**
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Modify: `frontend/src/shared/api/admin.js`

**Interfaces:**
- Consumes: `updatePresetDraft(id, version, input)`。

- [ ] **Step 1: Write the failing test**

Add a focused UI/API test that asserts a draft editor submits `PUT /api/admin/presets/:id/:version/draft`, while a published editor submits `POST /api/admin/presets/draft`.

- [ ] **Step 2: Run test to verify it fails**

Run the project’s focused frontend test command for the new test.

Expected: FAIL because editing always calls the creation endpoint.

- [ ] **Step 3: Write minimal implementation**

Track the edited record state and version; label actions and submit endpoint according to whether the source is a draft.

- [ ] **Step 4: Run test to verify it passes**

Run the focused frontend test and `npm --prefix frontend run build`.

Expected: PASS and production bundle builds.

### Task 4: Regression verification and commit

**Files:**
- Modify: only files from Tasks 1–3.

- [ ] **Step 1: Run backend tests**

Run: `node --test lib/preset-store.test.js routes/admin.test.js`

- [ ] **Step 2: Run frontend build**

Run: `npm --prefix frontend run build`

- [ ] **Step 3: Review diff and commit**

Run: `git diff --check && git status --short`; commit the focused feature and its tests.
