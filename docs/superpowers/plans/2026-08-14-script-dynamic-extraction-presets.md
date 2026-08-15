# 剧本动态提取预设同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户端剧本提取指令框实时反映管理后台已发布的提取预设，并使用管理员当前发布的提示词正文执行提取。

**Architecture:** 预设目录以 `protocolLock.format === 'extract'` 识别可用提取预设，用户端只以该目录中的稳定 ID 作为选择值。服务端在每次提取请求时按已发布目录验证 ID、读取当前正文；草稿和旧选项值在前端归一化。

**Tech Stack:** React、Ant Design、Express、Node.js 内置测试、Vite。

## Global Constraints

- 不新增第三方依赖。
- 用户端不得接收或显示预设正文。
- 仅 `module: script`、`kind: base`、`status: published`、`protocolLock.format: extract` 的预设出现在用户提取选择框。
- 管理员名称可变，预设 ID 是用户选择与服务端验证的稳定标识。
- 不添加代码注释。
- 不提交 Git 提交；仅由用户明确要求时提交。

---

## 文件结构

- 修改 `lib/system-preset-catalog.js`：把内置提取预设标记为 `format: extract`。
- 修改 `routes/chat.js`：按实时已发布提取目录验证和解析请求 ID。
- 修改 `frontend/src/user/pages/scriptDraftStorage.js`：将旧 `standard` 和 `novelPanel` 草稿值迁移为预设 ID。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：目录驱动的提取指令选择、状态文案和禁用行为。
- 创建 `frontend/src/user/pages/scriptExtractionPresets.js`：目录筛选、旧值迁移和有效选择回退等纯函数。
- 修改 `tests/system-preset-catalog.test.js`：覆盖目录协议与服务端动态解析。
- 创建 `tests/script-extraction-presets.test.js`：覆盖纯函数与草稿迁移。
- 创建 `tests/script-extraction-preset-ui-contract.test.js`：覆盖用户端不再写死提取名称。

### Task 1: 提取预设目录协议与服务端实时解析

**Files:**
- Modify: `lib/system-preset-catalog.js`
- Modify: `routes/chat.js`
- Modify: `tests/system-preset-catalog.test.js`

**Interfaces:**
- Produces `listPublishedExtractionPresets(presetStore) -> Preset[]`。
- Produces `resolveExtractionPresetId(value, presetStore) -> string | null`。
- `buildExtractMessages(body, presetStore)` 使用解析后的已发布预设 ID。

- [ ] **Step 1: 写入服务端失败测试**

```js
test('extract requests accept only published extract presets and use their latest body', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');
  const dynamic = store.createDraft('owner', {
    id: 'script-extract-custom', module: 'script', name: '自定义提取', kind: 'base',
    description: '动态提取', compatibleBaseIds: [], body: 'DYNAMIC_EXTRACT_BODY',
    protocolLock: { format: 'extract' }
  });
  store.publish('owner', dynamic.id, dynamic.version);
  const messages = chatRouter._private.buildExtractMessages({ extractionPreset: dynamic.id, novelText: '原文' }, store);
  assert.match(messages[0].content, /DYNAMIC_EXTRACT_BODY/);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/system-preset-catalog.test.js`

预期：失败，因为当前 `chat.js` 只接受 `standard` 和 `novelPanel`。

- [ ] **Step 3: 标记内置提取预设**

把 `script-extract` 与 `script-extract-novel-panel` 的 `protocolLock` 设为：

```js
{ format: 'extract', source: '...' }
```

保留原有 `source` 字段。

- [ ] **Step 4: 实现服务端目录与回退**

在 `chat.js` 中实现：

```js
function listPublishedExtractionPresets(presetStore) {
  return (presetStore?.listCatalog?.('script') || [])
    .filter(item => item.kind === 'base' && item.protocolLock?.format === 'extract');
}

function resolveExtractionPresetId(value, presetStore) {
  const presets = listPublishedExtractionPresets(presetStore);
  if (!presets.length) return null;
  return presets.some(item => item.id === value) ? value : presets[0].id;
}
```

`buildExtractMessages` 无可用提取预设时抛出 `No published extraction preset available`，其他无效值回退目录首项。导出两个函数到 `router._private`。

- [ ] **Step 5: 运行测试确认通过**

运行：`node --test tests/system-preset-catalog.test.js`

预期：通过，并确认自定义已发布提取预设正文被使用。

### Task 2: 草稿迁移与用户目录筛选工具

**Files:**
- Create: `frontend/src/user/pages/scriptExtractionPresets.js`
- Modify: `frontend/src/user/pages/scriptDraftStorage.js`
- Create: `tests/script-extraction-presets.test.js`

**Interfaces:**
- Produces `EXTRACTION_PRESET_MIGRATIONS`。
- Produces `filterExtractionPresets(catalog) -> Preset[]`。
- Produces `normalizeExtractionPresetId(value, presets) -> string`。
- Produces `selectAvailableExtractionPreset(value, presets) -> string | ''`。

- [ ] **Step 1: 写入纯函数失败测试**

```js
test('filters published extraction presets and migrates legacy selection values', async () => {
  const { filterExtractionPresets, selectAvailableExtractionPreset } = await import('../frontend/src/user/pages/scriptExtractionPresets.js');
  const presets = filterExtractionPresets([
    { id: 'script-extract', name: '管理员新名称', kind: 'base', protocolLock: { format: 'extract' } },
    { id: 'script-hook', name: '爆款开头', kind: 'base', protocolLock: { format: 'script' } }
  ]);
  assert.deepEqual(presets.map(item => item.name), ['管理员新名称']);
  assert.equal(selectAvailableExtractionPreset('standard', presets), 'script-extract');
  assert.equal(selectAvailableExtractionPreset('hidden-id', presets), 'script-extract');
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-extraction-presets.test.js`

预期：失败，因为模块不存在。

- [ ] **Step 3: 实现目录工具**

```js
export const EXTRACTION_PRESET_MIGRATIONS = {
  standard: 'script-extract',
  novelPanel: 'script-extract-novel-panel'
};

export function filterExtractionPresets(catalog) {
  return (Array.isArray(catalog) ? catalog : [])
    .filter(item => item?.kind === 'base' && item?.protocolLock?.format === 'extract');
}

export function selectAvailableExtractionPreset(value, presets) {
  const normalized = EXTRACTION_PRESET_MIGRATIONS[value] || value;
  return presets.some(item => item.id === normalized) ? normalized : (presets[0]?.id || '');
}
```

- [ ] **Step 4: 升级草稿默认值**

在 `scriptDraftStorage.js` 使用 `EXTRACTION_PRESET_MIGRATIONS`，使新草稿默认值为 `script-extract`，旧草稿 `standard`、`novelPanel` 自动迁移。

- [ ] **Step 5: 运行草稿与目录测试**

运行：`node --test tests/script-extraction-presets.test.js tests/script-draft-persistence-contract.test.js`

预期：通过。

### Task 3: 用户端动态提取指令框

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Create: `tests/script-extraction-preset-ui-contract.test.js`

**Interfaces:**
- Consumes `filterExtractionPresets` 和 `selectAvailableExtractionPreset`。
- `extractCharactersAndScenes(novelText, extractionPresetId)` 接收已发布预设 ID。

- [ ] **Step 1: 写入页面失败契约测试**

```js
test('script page renders extraction options from the published preset catalog', () => {
  assert.match(source, /filterExtractionPresets/);
  assert.match(source, /selectAvailableExtractionPreset/);
  assert.match(source, /extractionPresets\.map/);
  assert.doesNotMatch(source, /label: '剧本标准提取', value: 'standard'/);
  assert.doesNotMatch(source, /label: '小说面板提取', value: 'novelPanel'/);
});
```

- [ ] **Step 2: 运行页面测试确认失败**

运行：`node --test tests/script-extraction-preset-ui-contract.test.js`

预期：失败，因为 `ScriptPage.jsx` 仍包含写死选项。

- [ ] **Step 3: 动态加载和回退选择**

新增 `extractionPresets`、`loadingExtractionPresets` 和 `extractionPresetError` 状态。复用现有 `listScriptPresetCatalog()`，加载后过滤提取预设；使用 `selectAvailableExtractionPreset` 修正表单和已恢复草稿中隐藏的 ID，并通过现有 `persistDraft` 保存修正后的值。

- [ ] **Step 4: 渲染管理员目录名称**

当前指令名称从 `extractionPresets.find(item => item.id === extractionPreset)?.name` 获取。弹窗单选项使用：

```jsx
{extractionPresets.map(item => ({
  label: `${item.name} · v${item.version}`,
  value: item.id
}))}
```

在单选区域下显示选中预设的 `description`。删除全部写死的标准/小说面板名称和固定值。

- [ ] **Step 5: 处理无可用预设和加载失败**

无可用预设或目录读取失败时，提取按钮禁用；状态区明确显示“暂无已发布的提取指令”或“提取指令加载失败，请刷新或联系管理员”。禁止调用 `extractCharactersAndScenes`。

- [ ] **Step 6: 运行页面契约测试**

运行：`node --test tests/script-extraction-preset-ui-contract.test.js`

预期：通过。

### Task 4: 全量验证与发布构建

**Files:**
- Modify: 仅为修复验证发现的问题修改以上文件。

- [ ] **Step 1: 运行定向测试**

运行：

```powershell
node --test tests/system-preset-catalog.test.js tests/script-extraction-presets.test.js tests/script-extraction-preset-ui-contract.test.js tests/script-draft-persistence-contract.test.js
```

预期：全部通过。

- [ ] **Step 2: 执行前端生产构建**

运行：`npm --prefix frontend run build`

预期：Vite 构建成功。

- [ ] **Step 3: 检查改动文件诊断**

检查 `chat.js`、`scriptExtractionPresets.js`、`scriptDraftStorage.js` 和 `ScriptPage.jsx`，预期无诊断错误。

- [ ] **Step 4: 浏览器验收**

管理员发布一个 `protocolLock.format: extract` 的剧本基础预设后，刷新剧本页面确认其名称、说明和版本出现；改名发布后确认新名称出现；归档后确认该选项消失；用户已选归档项自动回退；点击提取后确认服务端使用当前已发布版本。

## 自检

- 规格覆盖：任务 1 覆盖线上目录与实时后端解析；任务 2 覆盖旧草稿兼容与选择回退；任务 3 覆盖用户框动态显示和不可用状态；任务 4 覆盖回归与构建。
- 占位符检查：计划不含 TBD、TODO 或未定义实现步骤。
- 接口一致性：任务 1 提供服务器目录解析；任务 2 提供客户端筛选和选择归一化；任务 3 使用相同预设 ID 提交给任务 1。
