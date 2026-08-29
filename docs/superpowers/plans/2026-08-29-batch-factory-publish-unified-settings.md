# Batch Factory Publish Unified Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move version sync out of production settings and into publish settings, reduce publish controls to reuse/flip, and automatically validate the Video Management System account when the publish drawer opens.

**Architecture:** Keep production constraints and publishing concerns separate. Publish-version snapshots live in a dedicated backend store and are copied into `batch.publishSettings` only after the user explicitly saves. Video Management System authentication is runtime-only behind a small authenticated adapter route; no credentials, account state, or account name enter version snapshots.

**Tech Stack:** Node.js 22 test runner (`node --test`), Express 5, React 18, Ant Design 5, existing GitHub Actions runner.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-publish-unified-settings.md`

## Global Constraints

- Product copy must use `视频管理系统`, never the internal nickname `121`.
- Production unified settings must not show publish version configuration or publish sync controls.
- Publish version configuration may persist only `materialReuse` and `horizontalFlip` plus batch snapshot metadata.
- Publish UI options are exactly `不复用 / 复用` and `不翻转 / 翻转`.
- New publish saves must not write `jieyaVideoCount` or `aiHead`.
- Opening publish unified settings automatically validates the Video Management System account.
- Online account UI is blue dot + account name + `账号在线`; expired/abnormal state shows `登录异常`, `账号登录状态已失效`, and `重新登录`.
- Runtime login state, cookies, credentials, and account name never enter version configuration.
- Do not fake a successful external login when the actual adapter is unavailable.

---

### Task 1: Lock the corrected UI and publish-version contract with failing tests

**Files:**
- Modify: `tests/batch-factory-constraints-ui-contract.test.js`
- Create: `tests/batch-factory-publish-config-version-store.test.js`
- Create: `.github/workflows/pr-node-tests.yml`

**Interfaces:**
- Consumes: current `BatchFactoryPageV9.jsx` and current version-store implementation.
- Produces: executable contract tests defining the corrected ownership and copy.

- [ ] **Step 1: Write failing UI contract tests**

Add assertions that isolate the `UnifiedSettings` and `PublishSettings` function source ranges and require:

```js
assert.doesNotMatch(unifiedSettingsSource, /版本配置|同步批量后台配置/);
assert.match(publishSettingsSource, /版本配置/);
assert.match(publishSettingsSource, /同步最新配置/);
assert.match(publishSettingsSource, /视频管理系统/);
assert.match(publishSettingsSource, /不复用/);
assert.match(publishSettingsSource, /复用/);
assert.match(publishSettingsSource, /不翻转/);
assert.match(publishSettingsSource, /翻转/);
assert.doesNotMatch(publishSettingsSource, /解压视频数量/);
assert.doesNotMatch(publishSettingsSource, /AI头部/);
```

- [ ] **Step 2: Write failing backend version-store test**

Create a test that expects a publish-only default record:

```js
const version = store.listForPublishing()[0];
assert.equal(version.name, '默认批量发布');
assert.equal(version.settings.materialReuse, false);
assert.equal(version.settings.horizontalFlip, false);
assert.equal(Object.hasOwn(version.settings, 'videoModelId'), false);
assert.equal(Object.hasOwn(version.settings, 'jieyaVideoCount'), false);
```

Also verify `saveVersion()` strips production fields and runtime auth fields.

- [ ] **Step 3: Add a PR test workflow so RED/GREEN can be observed remotely**

Create `.github/workflows/pr-node-tests.yml`:

```yaml
name: PR Node Tests
on:
  pull_request:
    branches: [master]
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm --prefix frontend install
      - run: npm test
      - run: npm run frontend:build
```

- [ ] **Step 4: Verify RED**

Use the PR head commit SHA with GitHub Actions. Expected result: `PR Node Tests` fails specifically because version configuration still appears in production settings and the version store is production-oriented.

- [ ] **Step 5: Commit**

The GitHub connector creates one commit per file write; ensure these test/workflow commits are visible on PR #8 before implementation.

---

### Task 2: Convert version storage from production configuration to publish configuration

**Files:**
- Modify: `lib/batch-factory/config-version-store.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `app.js` only if store naming changes
- Modify: `frontend/src/shared/api/batchFactory.js`

**Interfaces:**
- Produces: `listForPublishing()`, `saveVersion(input)`, `publish(key, version)`.
- HTTP: `GET /api/batch-factory/publish-config-versions` returns `{ versions, latestByKey }`.
- HTTP owner admin endpoints remain able to create/publish version records, but records are publish-only.

- [ ] **Step 1: Implement minimal publish-only sanitizer**

Persist only:

```js
{
  materialReuse: value.materialReuse === true,
  horizontalFlip: value.horizontalFlip === true
}
```

Default record:

```js
{
  key: 'batch-publish-default',
  name: '默认批量发布',
  version: 1,
  status: 'published',
  settings: { materialReuse: false, horizontalFlip: false }
}
```

- [ ] **Step 2: Expose publish-version routes**

Rename the production-facing read route to:

```text
GET /api/batch-factory/publish-config-versions
```

Return only published/archived publish versions. Runtime account state is not read or written by these routes.

- [ ] **Step 3: Update frontend API**

Expose:

```js
export function getBatchFactoryPublishConfigVersions() {
  return apiRequest(`${base}/publish-config-versions`);
}
```

Stop using a production-oriented config-version fetch from `UnifiedSettings`.

- [ ] **Step 4: Verify store tests GREEN**

Run through PR CI: `npm test` must pass the publish version-store tests.

---

### Task 3: Make publish settings the only owner of version selection and sync

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `routes/batch-factory-controls.js`
- Test: `tests/batch-factory-constraints-ui-contract.test.js`

**Interfaces:**
- `UnifiedSettings` owns only production settings and inline constraints.
- `PublishSettings` owns version selection/sync plus publish controls.
- `PUT /api/batch-factory/batches/:batchId/publish-settings` stores publish snapshot metadata and the two booleans.

- [ ] **Step 1: Remove version state and UI from `UnifiedSettings`**

Delete `versions`, `latestByKey`, version loading, `applyVersion`, `selectVersion`, `syncLatest`, version tags/select/buttons, and `configProfile*` writes from production settings.

- [ ] **Step 2: Rebuild `PublishSettings` draft model**

Initialize draft as:

```js
{
  materialReuse: current.materialReuse === true,
  horizontalFlip: current.horizontalFlip === true,
  configProfileKey: current.configProfileKey || '',
  configProfileName: current.configProfileName || '',
  configProfileVersion: Number(current.configProfileVersion || 0),
  configProfileSyncedAt: current.configProfileSyncedAt || ''
}
```

Load publish versions when the drawer opens. Selecting/syncing updates local draft only. `保存发布统一设置` persists the snapshot.

- [ ] **Step 3: Replace old publish controls with exact selects**

Use Ant Design `Select`:

```js
[
  { value: false, label: '不复用' },
  { value: true, label: '复用' }
]
```

and:

```js
[
  { value: false, label: '不翻转' },
  { value: true, label: '翻转' }
]
```

Remove `InputNumber`, `解压视频数量`, `AI头部`, and their save payload fields.

- [ ] **Step 4: Normalize backend publish settings without deprecated writes**

New writes return:

```js
{
  materialReuse,
  horizontalFlip,
  configProfileKey,
  configProfileName,
  configProfileVersion,
  configProfileSyncedAt
}
```

Do not copy `jieyaVideoCount` or `aiHead` into newly saved `publishSettings`.

- [ ] **Step 5: Verify UI contract GREEN**

PR CI `npm test` should pass corrected UI ownership/copy tests.

---

### Task 4: Add runtime Video Management System account validation adapter

**Files:**
- Create: `lib/batch-factory/video-management-account.js`
- Modify: `routes/batch-factory-controls.js`
- Modify: `frontend/src/shared/api/batchFactory.js`
- Create: `tests/batch-factory-video-management-account.test.js`

**Interfaces:**
- `resolveVideoManagementAccountStatus({ accountAdapter, username }) -> Promise<{ state, accountName, loginUrl?, message? }>`
- HTTP: `GET /api/batch-factory/video-management-account/status`
- HTTP: `POST /api/batch-factory/video-management-account/relogin`
- States: `online | login_required | unavailable`.

- [ ] **Step 1: Write failing adapter tests**

Required real behavior:

```js
assert.deepEqual(await resolveVideoManagementAccountStatus({
  accountAdapter: { getStatus: async () => ({ online: true, accountName: '小明' }) },
  username: 'tester'
}), { state: 'online', accountName: '小明' });
```

For missing adapter, expect:

```js
{ state: 'unavailable', accountName: '', message: '视频管理系统账号验证能力暂不可用' }
```

No path may manufacture `online` without adapter confirmation.

- [ ] **Step 2: Verify RED**

PR CI fails because `video-management-account.js` does not yet exist.

- [ ] **Step 3: Implement adapter resolver**

Use only explicitly injected adapter functions. Never read/write credentials or cookies in batch-factory code.

- [ ] **Step 4: Add authenticated status/relogin routes**

Status route calls adapter. Relogin route calls an injected existing integration method when present and returns the actual login URL/action; when absent, return `503`/`unavailable` instead of inventing an address.

- [ ] **Step 5: Verify adapter tests GREEN**

PR CI `npm test` must pass.

---

### Task 5: Render automatic account validation in the publish drawer

**Files:**
- Modify: `frontend/src/user/pages/BatchFactoryPageV9.jsx`
- Modify: `frontend/src/shared/api/batchFactory.js`
- Modify: `tests/batch-factory-constraints-ui-contract.test.js`

**Interfaces:**
- `getBatchFactoryVideoManagementAccountStatus()` fetches runtime state.
- `reloginBatchFactoryVideoManagementAccount()` starts the real relogin action when available.

- [ ] **Step 1: Add failing UI assertions for account states**

Require the publish drawer source to contain:

```js
assert.match(publishSettingsSource, /视频管理系统/);
assert.match(publishSettingsSource, /正在验证账号状态/);
assert.match(publishSettingsSource, /账号在线/);
assert.match(publishSettingsSource, /登录异常/);
assert.match(publishSettingsSource, /账号登录状态已失效/);
assert.match(publishSettingsSource, /重新登录/);
```

- [ ] **Step 2: Verify RED**

PR CI fails until the UI state machine is implemented.

- [ ] **Step 3: Implement open-time validation**

When `open` changes to true:

```js
setAccountState({ loading: true, state: '', accountName: '' });
getBatchFactoryVideoManagementAccountStatus()
  .then(...)
  .catch(...);
```

Render online as a blue Ant Design badge/dot plus account name. Render an error alert and `重新登录` only for non-online states.

- [ ] **Step 4: Implement relogin and automatic revalidation**

Call the real backend relogin action. If it returns a URL, open it with `window.open`. After the action completes or the login window closes, request status again; never optimistically set online.

- [ ] **Step 5: Verify UI tests and frontend build GREEN**

PR CI must pass both `npm test` and `npm run frontend:build`.

---

### Task 6: Final regression and PR verification

**Files:**
- Review all changed files on PR #8.

**Interfaces:**
- No new behavior; verification only.

- [ ] **Step 1: Run complete CI**

Expected commands:

```bash
npm test
npm run frontend:build
```

Both must pass in `PR Node Tests`.

- [ ] **Step 2: Review PR diff against the spec**

Confirm:

```text
生产统一设置：无版本配置；内联 5 项约束保持不变
发布统一设置：版本配置 + 同步 + 视频管理系统状态 + 不复用/复用 + 不翻转/翻转
无解压视频数量
无AI头部
无运行时账号数据写入版本配置
```

- [ ] **Step 3: Check PR mergeability and status checks**

PR #8 must remain mergeable, and the latest commit must have successful `PR Node Tests` status before reporting completion.
