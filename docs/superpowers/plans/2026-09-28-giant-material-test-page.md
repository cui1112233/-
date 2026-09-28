# 巨量素材独立测试页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地 `5173` 提供一个不写正式书单的 `/giant-material-test` 页面，验证巨量素材 ID 的授权查询、视频可读性和后续文本提取调用。

**Architecture:** Vite 开发服务器增加仅绑定回环地址的测试 API 中间件；它读取进程环境中的青语服务令牌，调用素材查询接口并返回已脱敏的元数据。React 测试页只展示阶段状态和结果，不使用 UserLayout、不依赖当前应用登录、不创建批量或小说记录。

**Tech Stack:** Vite middleware、Node.js `fetch`、React、Node test runner、现有前端 CSS。

## Global Constraints

- 测试页路径固定为 `/giant-material-test`，第一阶段绝不写入正式书单或批量数据。
- 只接受 10–25 位数字巨量素材 ID；服务端拒绝其它输入。
- Token 仅从 `QINGYU_N8_ADMIN_TOKEN` 读取，不进入响应、日志、前端代码或持久化文件。
- 测试 API 仅允许本机回环请求，并设置 20 秒请求超时。
- 当前已验证样本使用 `7689285397448523826`；不得把其它素材 ID 当滚屏验收样本。
- 第一阶段只验证素材查询和视频元数据；OCR 调用没有完成时必须显示“未执行/未配置”，不得伪造正文。

## File Structure

- `frontend/vite.config.js`：增加测试 API 中间件和本地回环限制。
- `frontend/src/user/pages/GiantMaterialTestPage.jsx`：独立输入页、阶段状态和结果展示。
- `frontend/src/user/pages/giant-material-test.css`：测试页样式，不污染批量工厂样式。
- `frontend/src/user/pages/giantMaterialTest.js`：ID 校验、响应归一化和展示状态纯函数。
- `frontend/src/user/pages/giantMaterialTest.test.js`：纯函数和响应边界测试。
- `frontend/src/user/App.jsx`：将该路径放在 UserLayout 外渲染，保证现有登录失效不阻塞测试页。

### Task 1: Freeze the test contract with pure failing tests

**Files:**
- Create: `frontend/src/user/pages/giantMaterialTest.js`
- Test: `frontend/src/user/pages/giantMaterialTest.test.js`

**Interfaces:**
- Produces `normalizeGiantMaterialId(value): string`.
- Produces `normalizeGiantMaterialResponse(payload): { materialId, giantMaterialId, title, platformBookId, platformName, videoUrl, width, height, durationSeconds }`.
- Produces `stageState(stage, value): { tone, label, detail }`.

- [ ] **Step 1: Write the failing tests**

```js
test('accepts only a 10 to 25 digit giant material ID', () => {
  assert.equal(normalizeGiantMaterialId(' 7689285397448523826 '), '7689285397448523826');
  assert.equal(normalizeGiantMaterialId('abc-7689285397448523826'), '');
  assert.equal(normalizeGiantMaterialId('123'), '');
});

test('normalizes only safe material metadata', () => {
  assert.deepEqual(normalizeGiantMaterialResponse({ data: { material_id: 10122315, giant_material_id: '7689285397448523826', title: '事不过三', book_id: 'book-1', platform_name: '七猫', video_url: 'https://material.hnqingyuwen.top/a.mp4', width: 720, height: 1280, duration: 281.03 } }), {
    materialId: '10122315', giantMaterialId: '7689285397448523826', title: '事不过三', platformBookId: 'book-1', platformName: '七猫', videoUrl: 'https://material.hnqingyuwen.top/a.mp4', width: 720, height: 1280, durationSeconds: 281.03
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected missing-module failure**

Run: `npm --prefix frontend exec -- node --test src/user/pages/giantMaterialTest.test.js`

Expected: FAIL because `giantMaterialTest.js` does not exist yet.

- [ ] **Step 3: Implement the smallest pure functions**

Use `String(value).trim()`, a strict `/^\d{10,25}$/` check, allowlisted response fields, and return empty strings/nulls for missing fields. Never copy unknown payload properties into the UI model.

- [ ] **Step 4: Run the focused test to green**

Run: `npm --prefix frontend exec -- node --test src/user/pages/giantMaterialTest.test.js`

- [ ] **Step 5: Commit the contract**

```bash
git add frontend/src/user/pages/giantMaterialTest.js frontend/src/user/pages/giantMaterialTest.test.js
git commit -m "test(batch): define giant material test contract"
```

### Task 2: Add the loopback Vite material probe

**Files:**
- Modify: `frontend/vite.config.js`
- Test: `frontend/vite.config.test.js`

**Interfaces:**
- `POST /__local/giant-material-test/resolve` accepts `{ giantMaterialId }`.
- Success returns `{ ok: true, stage: 'resolved', material: <normalized metadata> }`.
- Missing token returns HTTP 503 `{ ok: false, code: 'QINGYU_AUTH_NOT_CONFIGURED' }`.
- Upstream 401 returns HTTP 401 `{ ok: false, code: 'QINGYU_AUTH_FAILED' }` with no token text.

- [ ] **Step 1: Write the failing middleware contract tests**

Test the pure exported handler with injected `fetchImpl`, not a live Qingyu request. Assert request URL is `https://n8.hnqingyuwen.top/center-api/material/video/select`, body contains `ocean_material_ids` as an array of string IDs, token is only in the `N8-Admin-Token` header (confirmed from the logged-in browser request), malformed IDs are 400, and response never contains the token. Normalize the real `data.list`, `path`, and `works` fields. Preserve multiple platform book associations for explicit selection before any future registration.

- [ ] **Step 2: Run and verify red**

Run: `npm --prefix frontend exec -- node --test vite.config.test.js`

Expected: FAIL because the exported test handler does not exist.

- [ ] **Step 3: Implement the handler and Vite middleware**

Export `createGiantMaterialTestHandler({ fetchImpl = fetch, getToken = () => process.env.QINGYU_N8_ADMIN_TOKEN, now = Date })`. Reject non-loopback `req.socket?.remoteAddress` and all methods except POST. Use `AbortSignal.timeout(20000)` where available, otherwise an `AbortController` timer. Redact all upstream body/error text before returning it.

- [ ] **Step 4: Run green and exercise the local endpoint without a token**

Run: `npm --prefix frontend exec -- node --test vite.config.test.js`.

Then: `curl -sS -X POST http://127.0.0.1:5173/__local/giant-material-test/resolve -H 'content-type: application/json' --data '{"giantMaterialId":"7689285397448523826"}'`.

Expected without configured token: `QINGYU_AUTH_NOT_CONFIGURED`; this is an honest runtime boundary, not a fake success.

- [ ] **Step 5: Commit the local probe**

```bash
git add frontend/vite.config.js frontend/vite.config.test.js
git commit -m "feat(batch): add loopback giant material probe"
```

### Task 3: Add the independent page and route it outside login

**Files:**
- Create: `frontend/src/user/pages/GiantMaterialTestPage.jsx`
- Create: `frontend/src/user/pages/giant-material-test.css`
- Modify: `frontend/src/user/App.jsx`
- Test: `frontend/src/user/pages/GiantMaterialTestPage.source.test.js`

**Interfaces:**
- The page sends only `{ giantMaterialId }` to the loopback probe.
- It never calls `createManualIntake`, batch endpoints, or list refresh APIs.

- [ ] **Step 1: Write the source-level failing tests**

Assert the page contains the ID input, the test button, labels for `素材解析`, `视频读取`, `滚屏 OCR`, and `小说正文`; assert it does not import or call batch intake APIs. Assert `UserApp` maps `/giant-material-test` to the page before `UserLayout`.

- [ ] **Step 2: Run and verify red**

Run: `npm --prefix frontend exec -- node --test src/user/pages/GiantMaterialTestPage.source.test.js`.

- [ ] **Step 3: Implement page states**

Use `idle`, `loading`, `resolved`, `failed` states. Render exact server code and next action for auth/configuration failures. On success show title, platform Book ID, platform name, material ID, URL host/path only, dimensions and duration. Keep the response text capped and never render raw JSON/token.

- [ ] **Step 4: Route outside the authenticated shell**

Import the page in `App.jsx`; before returning `<UserLayout>`, return the page when `pathname === '/giant-material-test'`. Keep every existing route unchanged.

- [ ] **Step 5: Run focused tests and build**

Run: `npm --prefix frontend exec -- node --test src/user/pages/giantMaterialTest.test.js src/user/pages/GiantMaterialTestPage.source.test.js` and `npm run frontend:build`.

- [ ] **Step 6: Commit the page**

```bash
git add frontend/src/user/App.jsx frontend/src/user/pages/GiantMaterialTestPage.jsx frontend/src/user/pages/giant-material-test.css frontend/src/user/pages/giantMaterialTest.js frontend/src/user/pages/giantMaterialTest.test.js frontend/src/user/pages/GiantMaterialTestPage.source.test.js
git commit -m "feat(batch): add giant material standalone test page"
```

### Task 4: Live verification and handoff to phase two

- [ ] **Step 1: Restart only the Vite process from the target checkout**

Keep the working directory `/Users/ming/Documents/ChatGPT/一战晟铭/frontend`; do not restart the unrelated 18081 service or modify persistent data.

- [ ] **Step 2: Verify the page with no token**

Open `http://127.0.0.1:5173/giant-material-test`. Enter `7689285397448523826`. Confirm the UI reports `QINGYU_AUTH_NOT_CONFIGURED` and no formal batch/book count changes.

- [ ] **Step 3: Verify the authorized call when the operator configures the token**

Set `QINGYU_N8_ADMIN_TOKEN` only in the Vite process environment and restart that process. Repeat the sample. Confirm the real response exposes metadata only and contains `materialId=10122315`, the platform title/Book ID/book city fields when provided by the upstream response, and the known MP4 URL host. Do not store or print the token.

- [ ] **Step 4: Record the phase boundary**

If the authorized response lacks platform Book ID or title, stop with an explicit upstream-field mapping issue. If it succeeds, the next plan will add OCR and an explicit “保存到当前批量” action; this plan must not add that write path.

- [ ] **Step 5: Run final checks**

Run `git diff --check`, the focused Node tests, and `npm run frontend:build`. Report separately whether the call was `not configured`, `auth failed`, `resolved`, or `resolved + OCR`.
