# Batch Factory Novel Fetch Platform Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让水货生产页的“新建批量”使用小说获取当前启用的书城平台表和同一组书单协议值。

**Architecture:** 小说获取工作台仍是平台表的唯一来源。Node 提供一个只返回平台表的受保护读接口，批量弹窗通过前端 API 读取、规范化并展示这些平台；V11 手动 intake 继续接收并持久化选择的原始 `platformId`，不触发小说获取的抓取、改文、AI 或上传流程。

**Tech Stack:** Express、React、Ant Design、Node test、Vite。

## Global Constraints

- 平台来源必须是小说获取工作台的 `configStore.getPlatforms()`，不能在批量工厂维护硬编码副本。
- 仅展示 `visible !== false`、具有非空 `id` 和 `name` 的平台；选择值使用字符串化的原始平台 ID。
- 平台读取失败或无可用平台时，批量弹窗不能提交创建。
- 保留现有输入格式、列顺序预设、自定义列顺序、多行书单、自动和内容范围；“确定创建”只创建 V11 批量作品。
- 不修改水货生产的创作漫剧入口或小说获取原有处理按钮。

---

### Task 1: Expose the Novel Fetch platform table without its AI configuration

**Files:**
- Modify: `routes/novel-fetch-workshop.js`
- Create: `test/novel-fetch-workshop-platforms.test.js`

**Interfaces:**
- Produces `visibleWorkshopPlatforms(configStore) -> Array<{id: string, name: string}>`.
- Produces authenticated `GET /api/novel-fetch-workshop/platforms -> { platforms }`.

- [ ] **Step 1: Write the failing test**

```js
const platforms = visibleWorkshopPlatforms({ getPlatforms: () => [
  { id: 2, name: '番茄付费' },
  { id: 15, name: '知乎付费', visible: false },
  { id: '', name: '无编号' }
] });
assert.deepEqual(platforms, [{ id: '2', name: '番茄付费' }]);
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/novel-fetch-workshop-platforms.test.js`

Expected: FAIL because `visibleWorkshopPlatforms` is not exported.

- [ ] **Step 3: Add the dedicated read contract**

Implement `visibleWorkshopPlatforms(configStore)` in `routes/novel-fetch-workshop.js`. It must filter hidden/invalid entries, stringify `id`, trim `name`, preserve source order, and return new objects. Add `router.get('/platforms', ...)` beside the existing protected config route; resolve the current request resources and return only `{ platforms: visibleWorkshopPlatforms(configStore) }`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/novel-fetch-workshop-platforms.test.js`

```bash
git add routes/novel-fetch-workshop.js test/novel-fetch-workshop-platforms.test.js
git commit -m "feat: expose novel fetch platforms"
```

### Task 2: Load and validate the shared platform table in the batch intake modal

**Files:**
- Modify: `frontend/src/shared/api/novelFetchWorkshop.js`
- Modify: `frontend/src/shared/api/novelFetchWorkshop.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`
- Create: `frontend/src/user/pages/shuihuo/batchFactoryPlatformOptions.js`
- Create: `frontend/src/user/pages/shuihuo/batchFactoryPlatformOptions.test.js`

**Interfaces:**
- Produces `getWorkshopPlatforms() -> Promise<{platforms: Array<{id: string, name: string}>}>`.
- Produces `batchFactoryPlatformOptions(platforms) -> Array<{value: string, label: string}>`.
- `BatchFactoryCreateModal` submits a nonempty platform ID from those options or does not call `onCreated`.

- [ ] **Step 1: Write failing pure-helper and client-contract tests**

```js
assert.deepEqual(
  batchFactoryPlatformOptions([{ id: '2', name: '番茄付费' }]),
  [{ value: '2', label: '番茄付费' }]
);
assert.equal(getWorkshopPlatformsPath(), '/api/novel-fetch-workshop/platforms');
```

- [ ] **Step 2: Verify RED**

Run: `node --test src/user/pages/shuihuo/batchFactoryPlatformOptions.test.js src/shared/api/novelFetchWorkshop.test.js`

Expected: FAIL because the helper and the platform client are absent.

- [ ] **Step 3: Implement the client and modal state**

Add `getWorkshopPlatforms()` to the existing Novel Fetch client and a small pure option helper that accepts only valid string ID/name pairs. In `BatchFactoryCreateModal`, remove the hardcoded platform array; when the modal opens, request the platform list, select the first available ID only if no current selection is present, and show a loading/empty/error message in the book-city control. Disable “确定创建” while loading, after an error, or when no selected valid option exists. Keep the selected ID unchanged in the `createManualIntake` payload.

- [ ] **Step 4: Verify GREEN and build**

Run:

```bash
node --test src/user/pages/shuihuo/batchFactoryPlatformOptions.test.js src/shared/api/novelFetchWorkshop.test.js
npm --prefix frontend test
npm --prefix frontend run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/novelFetchWorkshop.js frontend/src/shared/api/novelFetchWorkshop.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/batchFactoryPlatformOptions.js frontend/src/user/pages/shuihuo/batchFactoryPlatformOptions.test.js
git commit -m "feat: use novel fetch platforms for batch intake"
```

### Task 3: Verify the live local workflow without creating user content

**Files:**
- No source files.

**Interfaces:**
- Confirms `http://127.0.0.1:5173/shuihuo-production` loads the batch modal with the authenticated platform list.

- [ ] **Step 1: Check the protected platform response with the existing browser session**

Open the batch modal through the already-authenticated local browser. Confirm the dropdown labels correspond to the current Novel Fetch platform table and that no hardcoded “番茄 / 红果” list remains.

- [ ] **Step 2: Check submission guard without submitting**

Use the UI state to verify “确定创建” is disabled while the platform list is loading or failed; do not enter books or create a batch during this check.

- [ ] **Step 3: Record verification evidence**

Report the visible platform labels, the selected stored ID behavior, and build/test results. Do not claim real novel fetching, timed production, video generation, or 121 upload from this UI verification.

## Self-review

- The design requirement for one platform authority is implemented by Task 1 and consumed by Task 2.
- The no-hardcoded-platform and no-create-on-unavailable requirements are both covered by Task 2 tests and guards.
- The plan does not alter the confirmed separation between batch creation and Novel Fetch processing.
- All paths and interface names above are concrete; no placeholder or unowned production change remains.
