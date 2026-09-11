# 统一模型目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理者在个人中心一次性配置并启用文本、图片、视频模型；所有业务步骤按类型读取同一目录，成员实时看到管理者已启用且自己获授权的模型。

**Architecture:** 在现有账号级 `data/users/<manager>/api-config.json` 内新增版本化 `modelCatalog`，作为 V88 Node 侧模型事实来源，并将旧文本／图片／YD／H3 配置一次性迁入目录。`lib/model-catalog.js` 负责预设、归一化、脱敏和类型校验；`lib/model-catalog-runtime.js` 负责管理者归属、成员权限过滤和运行时模型解析。业务路由只接收模型 ID，再由服务端解析凭据和适配器，前端绝不取得 Key。

**Tech Stack:** Node.js 24、Express、React、Ant Design、node:test、现有账号配置 JSON、成员治理 `member-store`。

## Global Constraints

- 新管理者的文本、图片、视频可用目录都为空；绝不注入默认 GPT、H3、YD 或图片模型。
- 只有已保存凭据（或完成本地执行器配对）且显式 `enabled=true` 的模型会进入下拉框。
- 平台预设卡首版为 `yd2-mini-video`、`minimax-h3-video`、`local-doubao-executor-video`；自定义模型允许 `text`、`image`、`video` 三类。
- 121 是目标网站配置，不得写进模型目录。
- 成员可见模型 = 绑定管理者的已启用模型 ∩ 该成员对应 API scope；成员不得读取、写入或获得凭据。
- 下拉框展开和窗口重新获得焦点时请求最新目录；服务端提交时再次验证归属、类型、启用状态和权限。
- 模型停用或无权限时不得自动回退到其他模型或旧全局配置。
- API Key 不得出现在 JSON 响应、浏览器状态、日志、任务历史或测试输出。
- 不删除现有 `v88` 业务数据、历史任务或旧配置字段；仅在验证后迁入并保留回滚读取。

---

## File Structure

- Create: `lib/model-catalog.js` — 预设定义、模型记录归一化、凭据脱敏、旧配置迁入。
- Create: `lib/model-catalog-runtime.js` — 管理者归属、成员 scope、可见目录、提交模型解析。
- Modify: `lib/shared.js` — `DEFAULT_CONFIG`、读写时的目录迁移与旧 Key 兼容读取。
- Modify: `routes/config.js` — 管理者目录 CRUD 和成员安全只读接口。
- Create: `frontend/src/shared/api/modelCatalog.js` — 管理与选择目录的 API 客户端。
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx` — 预设卡、三类模型表、添加/编辑自定义模型弹窗。
- Create: `frontend/src/user/components/TypedModelSelect.jsx` — 展开/聚焦刷新、按 `kind` 过滤的统一下拉框。
- Modify: `lib/api-access.js`, `lib/team-model-runtime.js` — 文本/图片运行时依据 `modelId` 解析管理者模型。
- Modify: `routes/chat.js`, `routes/novel-fetch.js`, `routes/novel-panel.js`, `routes/batch-factory.js`, `frontend/src/user/pages/ScriptPage.jsx` — 文本步骤传递并校验文本模型 ID。
- Modify: `frontend/src/user/components/EntityImagePanel.jsx`, `frontend/src/user/pages/scriptEntityImages.js`, `routes/novel-panel.js`, `routes/shuihuo-production.js` — 图片步骤传递并校验图片模型 ID。
- Modify: `lib/video-model-catalog.js`, `routes/script-video.js`, `routes/batch-factory-v11.js`, `routes/batch-factory-production.js`, `routes/shuihuo-production.js` — 平台预设与自定义视频模型统一解析。
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`, `frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx`, `frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx`, `frontend/src/user/pages/shuihuo/AssetsView.jsx` — 视频／图片／文本选择改用统一组件。
- Create: `tests/model-catalog.test.js`, `tests/model-catalog-routes.test.js`, `tests/model-catalog-member-visibility.test.js`, `tests/model-catalog-legacy-migration.test.js`, `tests/model-catalog-business-contract.test.js`。

### Task 1: 建立模型目录领域模型与旧配置迁移

**Files:**
- Create: `lib/model-catalog.js`
- Modify: `lib/shared.js:DEFAULT_CONFIG`, `readConfig`, `writeConfig`, `publicConfig`, `getVideoApiKey`
- Test: `tests/model-catalog.test.js`
- Test: `tests/model-catalog-legacy-migration.test.js`

**Consumes:** 现有 `DEFAULT_CONFIG`、`normalizeImageConfig`、`normalizeVideoConfig`。

**Produces:** `MODEL_KINDS`、`PLATFORM_PRESETS`、`normalizeModelCatalog(raw, legacyConfig)`、`publicModel(model)`、`resolveCatalogModel(catalog, modelId, kind)`。

- [ ] **Step 1: 写失败测试，定义空目录、三类隔离和脱敏。**

```js
test('new manager has no available model until a configured model is enabled', () => {
  const catalog = normalizeModelCatalog([], {});
  assert.deepEqual(catalog, []);
  assert.equal(resolveCatalogModel(catalog, 'minimax-h3-video', 'video'), null);
});

test('public model never exposes credential', () => {
  const model = normalizeModelCatalog([{ id: 'text-gpt54', kind: 'text', credential: 'secret', enabled: true }], {})[0];
  assert.equal(JSON.stringify(publicModel(model)).includes('secret'), false);
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog.test.js tests/model-catalog-legacy-migration.test.js`

Expected: FAIL，因为模块和函数尚不存在。

- [ ] **Step 3: 实现不可变预设与目录归一化。**

```js
const PLATFORM_PRESETS = Object.freeze({
  'yd2-mini-video': { kind: 'video', credentialMode: 'apiKey', adapterKind: 'yd_video' },
  'minimax-h3-video': { kind: 'video', credentialMode: 'apiKey', adapterKind: 'autodl_comfyui_video', supportsReferenceImages: true },
  'local-doubao-executor-video': { kind: 'video', credentialMode: 'executorPairing', adapterKind: 'local_executor_video' }
});
function resolveCatalogModel(catalog, modelId, kind) {
  return (catalog || []).find(model => model.id === modelId && model.kind === kind && model.enabled) || null;
}
```

迁移规则：已有文本配置迁为一条禁用前可用的 `text` 自定义模型；已有图片配置迁为一条 `image` 自定义模型；已有 `ydApiKey`／`h3ApiKey` 分别迁为对应预设记录。仅对已有凭据的老账号迁入；新账号保持空目录。

- [ ] **Step 4: 在 `publicConfig` 中返回仅脱敏目录摘要，并保持旧字段可读。**

```js
return {
  ...safeConfig,
  modelCatalog: normalizedCatalog.map(publicModel),
  video: { ...safeVideo, ydHasApiKey: Boolean(videoYDApiKey), h3HasApiKey: Boolean(videoH3ApiKey) }
};
```

- [ ] **Step 5: 运行领域测试并提交。**

Run: `node --test tests/model-catalog.test.js tests/model-catalog-legacy-migration.test.js tests/video-api-config.test.js`

Expected: PASS；输出中不含测试凭据。

```bash
git add lib/model-catalog.js lib/shared.js tests/model-catalog.test.js tests/model-catalog-legacy-migration.test.js
git commit -m "feat: add account model catalog"
```

### Task 2: 实现管理者目录接口、成员可见接口与服务端校验

**Files:**
- Create: `lib/model-catalog-runtime.js`
- Modify: `routes/config.js`
- Modify: `lib/api-access.js`
- Test: `tests/model-catalog-routes.test.js`
- Test: `tests/model-catalog-member-visibility.test.js`

**Consumes:** Task 1 的 `resolveCatalogModel`、账号配置读写、`memberStore.canUseApi`。

**Produces:** `listVisibleModels({ username, kind })`、`resolveRuntimeModel({ username, kind, modelId })` 和 `/api/config/models`、`/api/models` 接口。

- [ ] **Step 1: 写失败测试，覆盖管理者 CRUD、成员过滤和跨类型拒绝。**

```js
test('member sees only enabled video models from its bound manager', async () => {
  const response = await request(app, 'GET', '/api/models?kind=video', memberToken);
  assert.deepEqual(response.body.models.map(model => model.id), ['minimax-h3-video']);
  assert.equal(JSON.stringify(response.body).includes('manager-secret'), false);
});

test('server rejects a text model submitted to an image operation', () => {
  assert.throws(() => resolveRuntimeModel({ username: 'member', kind: 'image', modelId: 'text-gpt54' }), /图片模型/);
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog-routes.test.js tests/model-catalog-member-visibility.test.js`

Expected: FAIL，因为 `/api/models` 和运行时解析器尚不存在。

- [ ] **Step 3: 添加接口并限制管理权限。**

```js
router.get('/models', (req, res) => res.json({ models: listVisibleModels({ username: req.username, kind: req.query.kind }) }));
router.post('/models', requireApiManager, (req, res) => res.status(201).json({ model: saveManagerModel(req.username, req.body) }));
router.patch('/models/:modelId', requireApiManager, (req, res) => res.json({ model: updateManagerModel(req.username, req.params.modelId, req.body) }));
router.delete('/models/:modelId', requireApiManager, (req, res) => removeManagerModel(req.username, req.params.modelId));
```

`requireApiManager` 必须复用 `apiManagementState`；成员对管理接口返回 403，读取接口按 `boundTo` 使用管理者目录并按 scope 过滤。

- [ ] **Step 4: 对删除执行引用保护。**

```js
if (isModelReferenced(ownerUsername, modelId)) {
  return res.status(409).json({ error: '该模型仍被默认设置或待执行任务引用，请先停用或解除引用' });
}
```

- [ ] **Step 5: 运行接口测试并提交。**

Run: `node --test tests/model-catalog-routes.test.js tests/model-catalog-member-visibility.test.js tests/api-config-text-save-contract.test.js`

Expected: PASS；成员可见列表无 Key、无其他类型、无未启用模型。

```bash
git add lib/model-catalog-runtime.js lib/api-access.js routes/config.js tests/model-catalog-routes.test.js tests/model-catalog-member-visibility.test.js
git commit -m "feat: expose permission-filtered model catalog"
```

### Task 3: 重构 API 配置为预设卡＋自定义模型管理

**Files:**
- Create: `frontend/src/shared/api/modelCatalog.js`
- Create: `frontend/src/user/components/TypedModelSelect.jsx`
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Modify: `frontend/src/shared/api/config.js`
- Test: `tests/model-catalog-api-config-ui.test.js`

**Consumes:** Task 2 的管理接口与只读选择接口。

**Produces:** 管理者可编辑的三组模型目录，以及任意页面可复用的 `TypedModelSelect`。

- [ ] **Step 1: 写失败的 UI 契约测试。**

```js
assert.match(source, /平台预设模型/);
assert.match(source, /YD2\.0 Mini（图生）/);
assert.match(source, /MiniMax H3 多图生视频/);
assert.match(source, /添加自定义模型/);
assert.match(selectSource, /kind/);
assert.match(selectSource, /onDropdownVisibleChange/);
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog-api-config-ui.test.js`

Expected: FAIL，因为现有页面只有单文本、单图片和两个视频 Key 输入框。

- [ ] **Step 3: 实现 API 客户端和可刷新的类型下拉框。**

```jsx
export function TypedModelSelect({ kind, value, onChange, disabled }) {
  const refresh = useCallback(() => listAvailableModels(kind).then(setModels), [kind]);
  useEffect(() => { refresh(); }, [refresh]);
  return <Select value={value} onChange={onChange} onDropdownVisibleChange={open => open && refresh()}
    onFocus={refresh} disabled={disabled} options={models.map(model => ({ value: model.id, label: model.displayName }))} />;
}
```

- [ ] **Step 4: 以三组表格展示目录，并以弹窗配置自定义模型。**

预设卡只展示所需字段：YD／H3 为 Key 与启用开关；本地豆包为配对状态与启用开关。自定义弹窗展示类型、API 格式、Base URL、模型 ID、显示名、Key、能力与启用开关。空类型目录显示“尚未添加可用模型”，不造默认选项。

- [ ] **Step 5: 运行 UI 契约测试和前端构建并提交。**

Run: `node --test tests/model-catalog-api-config-ui.test.js && npm --prefix frontend run build`

Expected: PASS，构建退出码为 0。

```bash
git add frontend/src/shared/api/modelCatalog.js frontend/src/shared/api/config.js frontend/src/user/components/TypedModelSelect.jsx frontend/src/user/pages/ApiConfigPage.jsx tests/model-catalog-api-config-ui.test.js
git commit -m "feat: manage preset and custom models in api config"
```

### Task 4: 接通全部文本业务步骤

**Files:**
- Modify: `lib/api-access.js`, `lib/team-model-runtime.js`
- Modify: `routes/chat.js`, `routes/novel-fetch.js`, `routes/novel-panel.js`, `routes/batch-factory.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/pages/NovelPanelPage.jsx`, `frontend/src/user/pages/NovelFetchPage.jsx`
- Test: `tests/model-catalog-business-contract.test.js`

**Consumes:** Task 2 的 `resolveRuntimeModel` 和 Task 3 的 `TypedModelSelect`。

**Produces:** 每一个文本生成请求携带 `textModelId`，且服务端按当前管理者目录解析配置。

- [ ] **Step 1: 写失败测试，覆盖剧本、小说获取、小说面板和批量工厂。**

```js
for (const file of ['routes/chat.js', 'routes/novel-fetch.js', 'routes/novel-panel.js', 'routes/batch-factory.js']) {
  assert.match(read(file), /textModelId|modelId/);
  assert.match(read(file), /resolveRuntimeModel/);
}
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog-business-contract.test.js`

Expected: FAIL，因为文本路由当前回落到账号单模型 `config.model`。

- [ ] **Step 3: 用稳定 ID 解析文本模型，不接受裸模型名。**

```js
const model = resolveRuntimeModel({ username: req.username, kind: 'text', modelId: req.body.textModelId });
const config = { provider: model.providerType, baseUrl: model.baseUrl, model: model.modelId, apiKey: model.credential };
```

无可用文本模型时返回 422；成员越权或类型不匹配返回 403／400，不回退到旧 `config.model`。

- [ ] **Step 4: 在文本步骤插入 `TypedModelSelect kind="text"`。**

剧本页用于人物场景提取和剧本生成；小说获取／小说面板用于各自的 AI 动作；批量工厂用于编排、导演稿和提示词步骤。每次展开选择框刷新目录。

- [ ] **Step 5: 运行文本链路回归并提交。**

Run: `node --test tests/model-catalog-business-contract.test.js tests/api-config-text-save-contract.test.js tests/script-card-protocol.test.js && npm --prefix frontend run build`

Expected: PASS；无文本模型时所有文本提交被阻止。

```bash
git add lib/api-access.js lib/team-model-runtime.js routes/chat.js routes/novel-fetch.js routes/novel-panel.js routes/batch-factory.js frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/NovelPanelPage.jsx frontend/src/user/pages/NovelFetchPage.jsx tests/model-catalog-business-contract.test.js
git commit -m "feat: route text workflows through model catalog"
```

### Task 5: 接通人物场景、批量工厂和水货生产的图片模型

**Files:**
- Modify: `frontend/src/user/components/EntityImagePanel.jsx`
- Modify: `frontend/src/user/pages/scriptEntityImages.js`
- Modify: `routes/novel-panel.js`, `routes/shuihuo-production.js`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`
- Test: `tests/model-catalog-image-contract.test.js`

**Consumes:** Task 2 的图片模型解析、Task 3 的 `TypedModelSelect`。

**Produces:** 图片生成请求的 `imageModelId`，并只接受图片目录条目。

- [ ] **Step 1: 写失败测试。**

```js
assert.match(read('frontend/src/user/components/EntityImagePanel.jsx'), /TypedModelSelect[\s\S]*kind="image"/);
assert.match(read('routes/novel-panel.js'), /imageModelId/);
assert.match(read('routes/shuihuo-production.js'), /kind: 'image'/);
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog-image-contract.test.js`

Expected: FAIL，因为人物／场景生图仍读取单一 `imageSettingsFromAccountConfig`。

- [ ] **Step 3: 将生图请求改为模型 ID 解析。**

```js
const imageModel = resolveRuntimeModel({ username: req.username, kind: 'image', modelId: req.body.imageModelId });
const settings = { base_url: imageModel.baseUrl, model: imageModel.modelId, api_key: imageModel.credential };
```

- [ ] **Step 4: 将图片选择框放到真正的图片步骤。**

人物／场景编辑弹窗的 AI 生图区域、批量工厂图片资产／首帧步骤和水货资产图片任务各使用一个 `TypedModelSelect kind="image"`；未选择或目录为空时不发请求。

- [ ] **Step 5: 运行图片回归并提交。**

Run: `node --test tests/model-catalog-image-contract.test.js tests/script-entity-image-generation-contract.test.js tests/novel-panel-image-config.test.js && npm --prefix frontend run build`

Expected: PASS；文本和视频 ID 均被图片路由拒绝。

```bash
git add frontend/src/user/components/EntityImagePanel.jsx frontend/src/user/pages/scriptEntityImages.js routes/novel-panel.js routes/shuihuo-production.js frontend/src/user/pages/shuihuo/AssetsView.jsx tests/model-catalog-image-contract.test.js
git commit -m "feat: select image models from shared catalog"
```

### Task 6: 接通 YD、H3、本地豆包及自定义视频模型

**Files:**
- Modify: `lib/video-model-catalog.js`, `routes/script-video.js`
- Modify: `routes/batch-factory-v11.js`, `routes/batch-factory-production.js`, `routes/shuihuo-production.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx`, `frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx`, `frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx`
- Test: `tests/model-catalog-video-contract.test.js`

**Consumes:** Task 1 平台预设、Task 2 的运行时解析。

**Produces:** 视频步骤以 `videoModelId` 调用预设适配器或自定义视频适配器。

- [ ] **Step 1: 写失败测试。**

```js
assert.match(read('routes/script-video.js'), /resolveRuntimeModel[\s\S]*kind: 'video'/);
assert.match(read('routes/batch-factory-production.js'), /videoModelId|modelId/);
assert.match(read('lib/video-model-catalog.js'), /PLATFORM_PRESETS|resolveCatalogModel/);
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test tests/model-catalog-video-contract.test.js tests/h3-script-video-route.test.js tests/h3-video-models-route.test.js`

Expected: FAIL，因为当前视频目录会无条件合并默认 YD/H3 模型。

- [ ] **Step 3: 改为只返回已启用的预设或自定义视频模型。**

```js
const model = resolveRuntimeModel({ username: req.username, kind: 'video', modelId: req.body.videoModelId });
if (model.adapterKind === 'autodl_comfyui_video') return submitH3(model.credential, model, request);
if (model.adapterKind === 'yd_video') return submitYD(model.credential, model, request);
if (model.adapterKind === 'local_executor_video') return submitLocalExecutor(model, request);
throw new Error('当前视频模型没有受支持的适配器');
```

H3 继续保留参考图、HTTPS 公网地址和最多 9 张图片校验；YD 和本地豆包保留各自现有约束。

- [ ] **Step 4: 替换所有视频选择框。**

剧本分镜视频、批量工厂单项／批量生产、水货生产配置都使用 `TypedModelSelect kind="video"`。新增或停用 H3／YD 后，成员下次展开相应选择框读取最新状态。

- [ ] **Step 5: 运行视频回归并提交。**

Run: `node --test tests/model-catalog-video-contract.test.js tests/h3-script-video-route.test.js tests/h3-video-models-route.test.js tests/batch-factory-v11-provider-sync.test.js && npm --prefix frontend run build`

Expected: PASS；未配置或未启用 H3／YD 不出现在视频下拉框。

```bash
git add lib/video-model-catalog.js routes/script-video.js routes/batch-factory-v11.js routes/batch-factory-production.js routes/shuihuo-production.js frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx tests/model-catalog-video-contract.test.js
git commit -m "feat: route video workflows through enabled catalog models"
```

### Task 7: 全链路验证、迁移回读与发布前检查

**Files:**
- Modify: `tests/model-catalog-business-contract.test.js`
- Modify: `tests/model-catalog-legacy-migration.test.js`
- Modify: `docs/superpowers/specs/2026-09-11-unified-model-catalog-design.md`

**Consumes:** Tasks 1–6。

**Produces:** 发布清单、完整回归证据和旧配置可回读保证。

- [ ] **Step 1: 写端到端契约矩阵测试。**

```js
test('adding only an image model leaves text and video selections empty', async () => {
  await saveModel(manager, { id: 'image-a', kind: 'image', enabled: true, credential: 'hidden' });
  assert.deepEqual((await listFor(member, 'text')).models, []);
  assert.deepEqual((await listFor(member, 'video')).models, []);
  assert.deepEqual((await listFor(member, 'image')).models.map(model => model.id), ['image-a']);
});
```

- [ ] **Step 2: 运行测试，验证新增／停用实时可见性。**

Run: `node --test tests/model-catalog*.test.js`

Expected: PASS；同一成员在两次 `GET /api/models?kind=video` 之间可观察到管理者启用／停用变化。

- [ ] **Step 3: 执行现有关键回归和构建。**

Run: `node --test tests/api-config-text-save-contract.test.js tests/video-api-config.test.js tests/h3-script-video-route.test.js tests/h3-video-models-route.test.js tests/script-entity-image-generation-contract.test.js tests/batch-factory-v11-provider-sync.test.js && npm --prefix frontend run build`

Expected: 全部 PASS，前端构建退出码为 0。

- [ ] **Step 4: 验证发布包前的源码状态。**

```bash
git status --short
git log --oneline -7
git diff --check HEAD~7..HEAD
```

Expected: 仅包含模型目录功能提交；不把生成的 `frontend/dist`、账号数据、凭据或无关改动纳入提交。

- [ ] **Step 5: 更新规格验收记录并提交。**

```bash
git add tests/model-catalog-business-contract.test.js tests/model-catalog-legacy-migration.test.js docs/superpowers/specs/2026-09-11-unified-model-catalog-design.md
git commit -m "test: verify unified model catalog workflows"
```

## Self-Review

- 规格的空目录、预设卡、自定义模型、三类隔离、成员可见性、即时刷新、停用处理、旧配置迁移、三套业务页面和凭据保护分别由 Tasks 1–7 覆盖。
- 所有任务先写失败测试，再执行最小实现，再运行明确命令；没有待定占位。
- `modelId`、`textModelId`、`imageModelId`、`videoModelId` 的语义在领域、接口和业务任务中保持一致：提交使用稳定 ID，服务端按步骤类型解析。

