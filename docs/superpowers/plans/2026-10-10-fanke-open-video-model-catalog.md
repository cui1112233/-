# 梵客视频 API 模型目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 API 配置加入一个梵客视频 API 平台预设：一个 API Key，一个从当前账号可用模型中选择的下拉框，并通过既有 Node 脚本视频异步链路调用所选模型。

**Architecture:** 服务端保存 Key、已选模型与能力快照；浏览器仅获得脱敏后的模型和目录。独立 Node 适配器请求梵客标准目录、提交与状态接口；`script-video` 使用任务 ID 前缀分流。Batch Factory Go 生产适配器不在本次改变。

**Tech Stack:** Node.js 18+, Express, `node:test`, React/Ant Design。

## Global Constraints

- 只在 `/private/tmp/v88-h3-workflow-20261008` 修改源码；不暂存 `frontend/dist`、`.release`、`RELEASE-SHA` 或 `backend/.release`。
- 不重启、替换或构建公网容器和镜像；完成后才进入一次统一部署。
- Key 仅由服务端使用，所有公开响应只保留 `hasCredential`。
- 只调用 `https://ai.fanke2026.xyz/api/open/v1` 的 `/models`、`/video/generate`、`/video/status`。
- 提交结果未知时绝不自动第二次 POST；真实付费生成必须另获用户授权。

### Task 1: 梵客模型目录与平台预设

**Files:** `lib/fanke-open-video-adapter.js` (new), `lib/model-catalog.js`, `test/fanke-open-video-adapter.test.js` (new), `test/fanke-open-video-config.test.js` (new).

**Interfaces:** 导出 `FANKE_OPEN_VIDEO_MODEL_ID`、`fetchFankeVideoModels`、`buildFankeGeneratePayload`、`parseFankeSubmitResponse` 与 `parseFankeStatusResponse`。`fanke-open-video` 记录只保存当前选中 `providerModel` 的安全能力快照。

- [ ] **Step 1: Write the failing tests**

```js
test('Fanke directory exposes only available video models', async () => {
  const models = await fetchFankeVideoModels({ apiKey: 'private-key', request: async request => {
    assert.equal(request.headers.Authorization, 'Bearer private-key');
    assert.equal(request.headers['X-Public-Model-Ids'], '1');
    return { statusCode: 200, text: JSON.stringify({ data: [{ id: 'ft-video-v1-ready', name: 'Ready', type: 'video', status: 'available', durations: [5], resolutions: ['720p'], aspect_ratios: ['9:16'], max_image_refs: 9 }, { id: 'ft-image-v1-ready', type: 'image', status: 'available' }] }) };
  }});
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'ft-video-v1-ready');
});
test('Fanke preset redacts API key but persists selected model', () => {
  const saved = normalizeModelCatalog([{ id: 'fanke-open-video', kind: 'video', enabled: true, credential: 'private-key', providerModel: { id: 'ft-video-v1-ready', name: 'Ready', durations: [5], resolutions: ['720p'], aspectRatios: ['9:16'], maxImageRefs: 9 } }], { modelCatalogVersion: 1 })[0];
  assert.equal(saved.modelId, 'ft-video-v1-ready');
  assert.equal(publicModel(saved).credential, undefined);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js`; expect module/preset failures.

- [ ] **Step 3: Implement GREEN**

Add a Node HTTPS adapter with bearer authorization and `X-Public-Model-Ids: 1`. Normalize only `type=video,status=available` records and declared duration, resolution, ratio, prompt, image/video/audio limits. Register `fanke-open-video` as `adapterKind: 'fanke_open_video'`; require a valid selected `providerModel` to enable it.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js`; expect PASS. Commit source and tests with message `feat: add fanke video catalog adapter`.

### Task 2: API 配置卡与模型下拉

**Files:** `routes/config.js`, `frontend/src/shared/api/modelCatalog.js`, `frontend/src/user/pages/ApiConfigPage.jsx`, `test/fanke-open-video-config-route.test.js` (new), `test/fanke-open-video-ui.test.js` (new).

**Interfaces:** 增加仅管理员可用的 `POST /api/config/models/fanke-open-video/catalog` 与前端 `refreshFankeVideoModels`；卡片包含 API Key、刷新可用模型、选择模型、启用开关及保存。

- [ ] **Step 1: Write the failing endpoint and UI tests**

```js
test('Fanke catalog endpoint uses a supplied key without persisting or returning it', async () => {
  const response = await request(router, 'POST', '/api/config/models/fanke-open-video/catalog', { credential: 'temporary-key' });
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body).includes('temporary-key'), false);
});
test('API config provides the Fanke refresh and selection controls', () => {
  assert.match(page, /fanke-open-video/);
  assert.match(page, /刷新可用模型/);
  assert.match(page, /refreshFankeVideoModels/);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js`; expect 404 and missing UI failures.

- [ ] **Step 3: Implement GREEN**

The endpoint requires API-manager authorization and uses a supplied non-empty Key or the stored Key. React keeps fetched choices only in component state, clears a newly entered Key after successful save, and sends the selected complete `providerModel` snapshot via existing model create/update routes. The enable switch remains unavailable until the selected model came from the current directory response.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js`; expect PASS. Commit with message `feat: configure fanke video preset models`.

### Task 3: Node 脚本视频提交与状态查询

**Files:** `routes/script-video.js`, `test/script-video-fanke.test.js` (new).

**Interfaces:** 对 `modelKey === 'fanke-open-video'` 返回 `fanke:<jobId>`；状态查询按前缀调用梵客 `/video/status` 并返回既有 `{ ok, taskId, status }` 合约。

- [ ] **Step 1: Write the failing submission and polling tests**

```js
test('Fanke selected model submits one job and returns fanke job id', async () => {
  const response = await submitScriptVideo({ modelKey: 'fanke-open-video', prompt: 'scene', duration: 5, resolution: '720p', aspectRatio: '9:16', imageUrls: ['https://media.example/frame.jpg'] });
  assert.equal(response.status, 202);
  assert.equal(response.body.taskId, 'fanke:job-42');
});
test('Fanke status success needs an HTTPS video URL', async () => {
  const response = await getScriptVideoTask('fanke:job-42');
  assert.equal(response.body.status, 'succeeded');
  assert.equal(response.body.videoUrl, 'https://media.example/final.mp4');
});
test('Fanke submission transport failure does not resubmit', async () => {
  const response = await submitFailingFankeVideo();
  assert.equal(response.status, 502);
  assert.equal(submitAttempts, 1);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/script-video-fanke.test.js`; expect no Fanke branch failures.

- [ ] **Step 3: Implement GREEN**

Resolve the chosen runtime model, make reference assets publicly reachable with the existing helper, validate values against the selected model snapshot, submit once, parse `jobId`, and prefix it. On poll, map `submitted` to `processing`, `failed` to `failed`, and `success` with an HTTPS `videoUrl` to `succeeded`. Never implement a submit retry loop.

- [ ] **Step 4: Verify GREEN and commit**

Run `node --test test/script-video-fanke.test.js`; expect PASS. Commit with message `feat: submit script videos through fanke`.

### Task 4: Regression gate and one unified release

- [ ] **Step 1: Run focused suites**

Run `node --test test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js test/script-video-fanke.test.js`; expect PASS.

- [ ] **Step 2: Run syntax and frontend build checks**

Run `node --check lib/fanke-open-video-adapter.js && node --check lib/model-catalog.js && node --check routes/config.js && node --check routes/script-video.js && (cd frontend && npm run build)`; expect zero exit status.

- [ ] **Step 3: Verify and release once**

Run `git diff --check` and inspect `git status --short`; leave generated files untouched. Only after all checks and authenticated UI verification pass, use the existing V88 unified-release flow once. A real billable generation needs separate user authorization; without it accept only directory read, configuration save, and mocked submission/polling.
