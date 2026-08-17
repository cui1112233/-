# 管理端系统预设词闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在管理端安全维护快速剧本生成和小说面板的系统预设词，并让已发布版本自动用于后续后端生成请求。

**Architecture:** 在现有 JSON 版 `preset-store` 上增加受保护的管理员列表和详情读取接口，以及一次性默认种子初始化。快速剧本和小说面板通过服务端用途白名单解析当前发布版本，缺失时使用原始内置默认词；React 管理页只调用管理员 API 读取正文，普通用户 API 继续只返回元信息。

**Tech Stack:** Node.js 24、Express、JSON 持久化、Node test、React、Ant Design、Vite。

---

## 文件结构

- `lib/system-preset-catalog.js`：10 个固定用途、默认正文来源、启动种子和运行时解析。
- `lib/preset-store.js`：按模块列出全部版本，供管理员页面读取。
- `routes/admin.js`：管理员受保护的预设词列表和详情接口。
- `routes/chat.js`：快速剧本生成从已发布系统预设词组装 system message。
- `routes/novel-panel.js`：小说面板三类生成从已发布系统预设词组装 system message。
- `app.js`：创建应用时初始化默认种子，并将预设库传给生成路由。
- `frontend/src/shared/api/admin.js`：管理员预设词 API 客户端。
- `frontend/src/admin/pages/PresetLibraryPage.jsx`：预设词列表、编辑草稿、发布和回滚页面。
- `frontend/src/admin/App.jsx`、`frontend/src/shared/layouts/AdminLayout.jsx`：管理端路由和导航。
- `tests/system-preset-catalog.test.js`、`tests/governance-routes.test.js`、`tests/novel-panel-asset-contract.test.js`：种子、保密、发布生效和回退保护。

### Task 1: 默认预设词目录与持久化种子

**Files:**
- Create: `lib/system-preset-catalog.js`
- Modify: `lib/preset-store.js`
- Modify: `app.js`
- Test: `tests/system-preset-catalog.test.js`

- [ ] **Step 1: 写入失败测试**

```js
test('seeds the ten fixed server-only defaults once without overwriting a published edit', t => {
  const store = createPresetStore({ systemDir: tempSystemDir(t) });
  seedSystemPresets(store, 'owner');
  assert.equal(store.listAll('script').length, 7);
  assert.equal(store.listAll('novel-panel').length, 3);
  const original = store.getPublished('script-extract');
  store.createDraft('owner', { ...original, body: 'edited body', protocolLock: null });
  store.publish('owner', 'script-extract', 2);
  seedSystemPresets(store, 'owner');
  assert.equal(store.getPublished('script-extract').body, 'edited body');
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `node --test tests/system-preset-catalog.test.js`

Expected: FAIL because `system-preset-catalog` and `listAll/getPublished` do not exist.

- [ ] **Step 3: 实现目录、只初始化一次的种子和内部查询**

```js
const SYSTEM_PRESETS = Object.freeze([
  { id: 'script-extract', module: 'script', name: '人物场景提取', source: '人物场景提取.md' },
  { id: 'script-hook', module: 'script', name: '爆款开头', source: '爆款开头.md' },
  { id: 'script-continuous', module: 'script', name: '连续开头', source: '连续开头.md' }
]);

function seedSystemPresets(store, actor) {
  for (const preset of SYSTEM_PRESETS) {
    if (store.listAll(preset.module).some(item => item.id === preset.id)) continue;
    const created = store.createDraft(actor, { ...preset, kind: 'base', description: '', compatibleBaseIds: [], body: defaultBody(preset), protocolLock: null });
    store.publish(actor, created.id, created.version);
  }
}
```

`preset-store` 增加内部 `listAll(module)` 和 `getPublished(id)`，返回克隆后的完整记录；普通用户公开 API 仍只使用 `publicPreset`。

- [ ] **Step 4: 运行绿灯测试**

Run: `node --test tests/system-preset-catalog.test.js tests/preset-store.test.js`

Expected: PASS。

### Task 2: 受保护管理员预设词读取接口

**Files:**
- Modify: `routes/admin.js`
- Test: `tests/governance-routes.test.js`

- [ ] **Step 1: 写入失败测试**

```js
test('only scoped preset administrators can read a preset body', async t => {
  const { app, owner, writer } = await setupPresetApp(t);
  const denied = await request(app, { requestPath: '/api/admin/presets?module=script', token: writer });
  assert.equal(denied.status, 403);
  const allowed = await request(app, { requestPath: '/api/admin/presets?module=script', token: owner });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.presets[0].body, 'SERVER_ONLY_BODY');
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `node --test tests/governance-routes.test.js`

Expected: FAIL because `GET /api/admin/presets` is absent.

- [ ] **Step 3: 实现管理员列表和详情路由**

```js
router.get('/presets', (req, res) => {
  const module = req.query.module;
  if (!accountStore.can(req.username, 'preset:draft', module) && !accountStore.can(req.username, 'preset:publish', module)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({ presets: presetStore.listAll(module) });
});

router.get('/presets/:id/:version', (req, res) => {
  const preset = presetStore.getVersion(req.params.id, Number(req.params.version));
  if (!preset || (!accountStore.can(req.username, 'preset:draft', preset.module) && !accountStore.can(req.username, 'preset:publish', preset.module))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({ preset });
});
```

详情不存在时返回 404；不得将任何管理员权限放到普通 `/api/presets` 路由。

- [ ] **Step 4: 运行绿灯测试**

Run: `node --test tests/governance-routes.test.js`

Expected: PASS，既有普通目录与解析响应不含 `body`。

### Task 3: 快速剧本生成使用已发布版本

**Files:**
- Modify: `routes/chat.js`
- Modify: `app.js`
- Test: `tests/system-preset-catalog.test.js`

- [ ] **Step 1: 写入失败测试**

```js
test('script request uses only the current published preset body', () => {
  const store = seededStore();
  store.createDraft('owner', edit('script-extract', 'NEW_EXTRACT_RULE'));
  const messagesBeforePublish = buildChatMessages({ promptType: 'extract', novelText: 'text' }, store);
  assert.doesNotMatch(messagesBeforePublish[0].content, /NEW_EXTRACT_RULE/);
  store.publish('owner', 'script-extract', 2);
  const messagesAfterPublish = buildChatMessages({ promptType: 'extract', novelText: 'text' }, store);
  assert.match(messagesAfterPublish[0].content, /NEW_EXTRACT_RULE/);
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `node --test tests/system-preset-catalog.test.js`

Expected: FAIL because chat message builders ignore `presetStore`.

- [ ] **Step 3: 让 chat router 接收并使用预设库**

将 `routes/chat.js` 改为 `createChatRouter(presetStore)`，并让 `buildExtractMessages`、`buildScriptMessages` 通过 `resolveSystemPresetBody(presetStore, id)` 获取正文。固定组合保持如下：

```js
extract: ['script-extract']
script hook screenplay: ['script-hook', 'script-general', 'script-format-screenplay']
script continuous storyboard: ['script-continuous', 'script-general', 'script-format-storyboard']
```

`app.js` 挂载 `app.use('/api', createChatRouter(resolvedPresetStore))`。没有发布版本时，解析函数回退到现有 `.md` 默认正文。

- [ ] **Step 4: 运行绿灯测试**

Run: `node --test tests/system-preset-catalog.test.js tests/governance-routes.test.js`

Expected: PASS。

### Task 4: 小说面板使用已发布版本

**Files:**
- Modify: `routes/novel-panel.js`
- Modify: `app.js`
- Test: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 写入失败测试**

```js
test('novel panel prompt assembly changes only after its preset is published', () => {
  const store = seededStore();
  const before = buildPanelSystemPrompt(store, 'analysis');
  store.createDraft('owner', edit('novel-analysis', 'NEW_ANALYSIS_RULE'));
  assert.equal(buildPanelSystemPrompt(store, 'analysis'), before);
  store.publish('owner', 'novel-analysis', 2);
  assert.match(buildPanelSystemPrompt(store, 'analysis'), /NEW_ANALYSIS_RULE/);
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `node --test tests/novel-panel-asset-contract.test.js`

Expected: FAIL because `novel-panel` exports no store-backed prompt builder.

- [ ] **Step 3: 让小说面板路由工厂化并保留协议锁**

将 `routes/novel-panel.js` 导出为 `createNovelPanelRouter(presetStore)`。`analysisSystemPrompt`、`characterSystemPrompt`、`outlineSystemPrompt` 改为分别使用 `novel-analysis`、`novel-character`、`novel-outline` 的已发布正文，并附加现有 JSON 和质量闸门协议锁文本。`app.js` 以预设库创建后挂载该路由。

- [ ] **Step 4: 运行绿灯测试**

Run: `node --test tests/novel-panel-asset-contract.test.js`

Expected: PASS，CSP、iframe bridge 和现有小说面板 API 覆盖无回归。

### Task 5: React 管理预设词页面

**Files:**
- Create: `frontend/src/shared/api/admin.js`
- Create: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Modify: `frontend/src/admin/App.jsx`
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Modify: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 写入失败静态契约**

```js
exists('frontend/src/admin/pages/PresetLibraryPage.jsx');
assert(read('frontend/src/admin/App.jsx').includes("'/admin/presets'"));
assert(read('frontend/src/shared/layouts/AdminLayout.jsx').includes("'/admin/presets'"));
assert(read('frontend/src/shared/api/admin.js').includes("'/api/admin/presets'"));
```

- [ ] **Step 2: 运行红灯检查**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: FAIL because API client and routed page do not exist.

- [ ] **Step 3: 实现管理员 API 与页面**

```js
export const listAdminPresets = module => apiRequest(`/api/admin/presets?module=${encodeURIComponent(module)}`);
export const createPresetDraft = input => apiRequest('/api/admin/presets/draft', { method: 'POST', body: JSON.stringify(input) });
export const publishPreset = (id, version) => apiRequest(`/api/admin/presets/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ version }) });
export const rollbackPreset = (id, version) => apiRequest(`/api/admin/presets/${encodeURIComponent(id)}/rollback`, { method: 'POST', body: JSON.stringify({ version }) });
```

`PresetLibraryPage` 使用 Ant Design 的 `Tabs`、`Table`、`Modal`、`Form`、`Input.TextArea`、`Tag`、`Popconfirm`。模块切换为“剧本生成”和“小说面板”；列表显示版本和状态；正文仅在获授权页面加载后显示。草稿保存后刷新列表，发布或回滚后刷新列表并给出消息反馈。

- [ ] **Step 4: 运行绿灯构建与静态检查**

Run: `npm --prefix frontend run build && node scripts/validate-react-frontend-architecture.js`

Expected: build exits 0；若架构检查仍因现有无关 CSS 标记失败，则单独报告，不借本功能修改无关 UI。

### Task 6: 全量验证与浏览器验收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-admin-managed-system-presets-design.md`

- [ ] **Step 1: 运行后端回归**

Run: `node --test tests/*.test.js`

Expected: all tests pass.

- [ ] **Step 2: 重启并验证实际服务**

Run: `launchctl kickstart -k gui/$(id -u)/com.ming.qiantie && curl -sS http://127.0.0.1:3000/api/admin/presets -o /dev/null -w '%{http_code}\n'`

Expected: service restarts; unauthenticated endpoint returns `401`.

- [ ] **Step 3: 管理端浏览器验收**

使用主账号登录 `/admin/presets`，确认可见预设词页面、正文编辑、草稿、发布、回滚控制；打开普通用户的 `/api/presets` 响应，确认无 `body` 或 `protocolLock`。

- [ ] **Step 4: 记录验收结果**

在设计文档末尾记录实际通过的测试命令、浏览器验证范围和未覆盖的外部模型调用。
