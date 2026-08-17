# 剧本人物场景维护与主角白名单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许剧本生成用户新增、编辑、删除人物与场景，并通过星标建立会影响生成结果的主角白名单。

**Architecture:** 前端将提取结果归一化为带稳定 ID 的实体记录，草稿保存这些记录和主角 ID 集合。生成请求继续发送原始人物与场景数据，同时发送从主角 ID 集合解析出的 `protagonists`；后端仅保留当前人物列表内可验证的白名单项，并把主角约束注入用户提示词。

**Tech Stack:** React、Ant Design、Lucide React、Express、Node.js 内置测试、Vite。

## Global Constraints

- 不新增第三方依赖。
- 维持现有本地账号维度剧本草稿存储。
- 使用稳定实体 ID 关联主角，而非人物名称。
- 不记录或暴露任何密钥。
- 不添加代码注释。
- 不提交 Git 提交；仅由用户明确要求时提交。

---

## 文件结构

- 修改 `frontend/src/user/pages/scriptEntities.js`：实体归一化、数据解包、主角白名单解析和可提交数据转换。
- 修改 `frontend/src/user/pages/scriptDraftStorage.js`：升级草稿版本并兼容旧 `extractInfo`。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：人物场景新增、编辑、删除、星标交互及生成请求。
- 修改 `frontend/src/shared/api/generation.js`：将 `protagonists` 放入剧本生成请求体。
- 修改 `routes/chat.js`：验证白名单成员并注入生成提示词。
- 修改 `frontend/src/shared/styles/global.css`：实体卡片、星标、添加按钮和危险操作样式。
- 创建 `tests/script-entity-management.test.js`：实体归一化和白名单数据逻辑。
- 创建 `tests/script-protagonist-generation-contract.test.js`：前后端白名单请求及提示词契约。
- 修改 `tests/script-draft-persistence-contract.test.js`：覆盖草稿版本与旧数据兼容。

### Task 1: 实体数据归一化与草稿兼容

**Files:**
- Create: `frontend/src/user/pages/scriptEntities.js`
- Modify: `frontend/src/user/pages/scriptDraftStorage.js`
- Create: `tests/script-entity-management.test.js`
- Modify: `tests/script-draft-persistence-contract.test.js`

**Interfaces:**
- Produces `normalizeExtractInfo(value) -> { characters, scenes, protagonistIds }`。
- Produces `entityData(record) -> string | object`。
- Produces `collectProtagonists(extractInfo) -> Array<string | object>`。
- Produces `toGenerationEntities(extractInfo) -> { characters, scenes, protagonists }`。

- [ ] **Step 1: 写入归一化失败测试**

```js
test('normalizes legacy entities into stable records and retains valid protagonists', () => {
  const result = normalizeExtractInfo({
    characters: [{ name: '沈清' }, '顾言'],
    scenes: [{ name: '书房' }],
    protagonistIds: ['legacy-missing']
  });
  assert.equal(result.characters.length, 2);
  assert.ok(result.characters.every(item => item.id && Object.hasOwn(item, 'data')));
  assert.deepEqual(result.protagonistIds, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-entity-management.test.js`

预期：失败，提示 `scriptEntities.js` 或 `normalizeExtractInfo` 不存在。

- [ ] **Step 3: 创建实体工具模块**

实现以下最小接口：

```js
export function createEntity(data, id = crypto.randomUUID()) {
  return { id, data };
}

export function normalizeExtractInfo(value) {
  const characters = normalizeEntityList(value?.characters);
  const scenes = normalizeEntityList(value?.scenes);
  const characterIds = new Set(characters.map(item => item.id));
  return {
    characters,
    scenes,
    protagonistIds: Array.isArray(value?.protagonistIds)
      ? value.protagonistIds.filter(id => characterIds.has(id))
      : []
  };
}
```

`normalizeEntityList` 必须保留现有 `{ id, data }` 记录，其他字符串或对象包装为新记录。`collectProtagonists` 必须只返回主角 ID 对应的 `data`。

- [ ] **Step 4: 升级草稿归一化**

将 `draftVersion` 从 `2` 升级到 `3`，接受 `1`、`2`、`3` 三种版本；在 `normalizeDraft` 中调用：

```js
extractInfo: normalizeExtractInfo(draft.extractInfo)
```

- [ ] **Step 5: 运行实体与草稿测试**

运行：`node --test tests/script-entity-management.test.js tests/script-draft-persistence-contract.test.js`

预期：全部通过。

### Task 2: 人物与场景维护界面

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Create: `tests/script-entity-ui-contract.test.js`

**Interfaces:**
- Consumes `normalizeExtractInfo`、`entityData`、`toGenerationEntities`。
- Produces `addEntity(type)`、`toggleProtagonist(entityId)`、`deleteActiveEntity()`。

- [ ] **Step 1: 写入页面契约失败测试**

```js
test('script page provides entity creation, protagonist toggling and deletion controls', () => {
  assert.match(source, /添加人物/);
  assert.match(source, /添加场景/);
  assert.match(source, /toggleProtagonist/);
  assert.match(source, /删除人物/);
  assert.match(source, /删除场景/);
  assert.match(source, /Star/);
});
```

- [ ] **Step 2: 运行页面契约测试确认失败**

运行：`node --test tests/script-entity-ui-contract.test.js`

预期：失败，缺少新增、星标或删除入口。

- [ ] **Step 3: 将提取结果和草稿恢复统一为实体记录**

在 `ScriptPage.jsx` 中：

```js
const EMPTY_EXTRACT_INFO = { characters: [], scenes: [], protagonistIds: [] };
```

提取、恢复和清空状态均使用 `normalizeExtractInfo`。显示名称和编辑字段均传入 `entityData(record)`。

- [ ] **Step 4: 实现卡片操作**

在 `EntitySection` 传入 `onAdd`、`onToggleProtagonist` 与 `protagonistIds`。人物标题右侧显示“添加人物”，场景标题右侧显示“添加场景”。人物卡的星标按钮必须调用 `event.stopPropagation()`，避免同时打开编辑弹窗：

```jsx
<Button
  type="text"
  aria-label={isProtagonist ? '取消主角标记' : '设为主角'}
  icon={<Star fill={isProtagonist ? 'currentColor' : 'none'} />}
  onClick={event => { event.stopPropagation(); onToggleProtagonist(item.id); }}
/>
```

- [ ] **Step 5: 扩展统一编辑弹窗**

`activeEntity` 使用 `{ type, id, isNew }`。新增时提供默认字段：人物包含“名称、身份、外形、性格”，场景包含“名称、时段、氛围、描述”。弹窗底部的删除按钮仅在非新增记录显示，并通过 `Popconfirm` 确认。删除人物时移除对应 `protagonistIds`。

- [ ] **Step 6: 在维护后使旧输出失效**

新增、编辑、删除或切换星标后统一调用状态更新函数：清空 `output`、设为 `extracted`（存在任何实体时）或 `idle`（人物与场景都为空），再通过现有 `persistDraft` 保存。

- [ ] **Step 7: 添加样式**

新增 `.entity-card-row`、`.entity-card-main`、`.entity-protagonist-toggle`、`.entity-add-button` 和 `.entity-editor-danger`。保持现有 `--legacy-*` 主题变量；星标主角使用 `--legacy-accent`，不改变卡片的点击编辑区域。

- [ ] **Step 8: 运行 UI 契约测试**

运行：`node --test tests/script-entity-ui-contract.test.js`

预期：通过。

### Task 3: 白名单生成请求与服务端验证

**Files:**
- Modify: `frontend/src/shared/api/generation.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `routes/chat.js`
- Create: `tests/script-protagonist-generation-contract.test.js`

**Interfaces:**
- `generateScript({ mode, format, duration, novelText, characters, scenes, protagonists, constraints })`。
- `sanitizeProtagonists(characters, protagonists) -> Array<string | object>`。

- [ ] **Step 1: 写入后端白名单失败测试**

```js
test('script messages include only protagonists that belong to the character list', () => {
  const messages = buildScriptMessages({
    mode: 'continuous',
    format: 'storyboard',
    duration: '10s',
    novelText: '原文',
    characters: [{ name: '沈清' }],
    scenes: [],
    protagonists: [{ name: '沈清' }, { name: '伪造人物' }]
  }, store);
  assert.match(messages[1].content, /主角白名单/);
  assert.match(messages[1].content, /沈清/);
  assert.doesNotMatch(messages[1].content, /伪造人物/);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-protagonist-generation-contract.test.js`

预期：失败，尚未处理 `protagonists`。

- [ ] **Step 3: 前端发送白名单**

在 `generateScript` 请求体加入 `protagonists`。`ScriptPage.jsx` 调用 `toGenerationEntities(extractInfo)`，并将该函数返回的三个列表传递给 API。

- [ ] **Step 4: 服务端过滤并注入提示词**

在 `routes/chat.js` 增加：

```js
function sanitizeProtagonists(characters, protagonists) {
  const known = new Set((Array.isArray(characters) ? characters : []).map(item => JSON.stringify(item)));
  return (Array.isArray(protagonists) ? protagonists : []).filter(item => known.has(JSON.stringify(item)));
}
```

在用户消息的“人物信息”后，仅当白名单非空时加入：

```text
## 主角白名单（优先级最高）
<序列化后的主角列表>

必须优先围绕这些主角组织剧情、镜头和人物一致性；不得改名、合并、替换或弱化其身份、外形与关键关系。
```

- [ ] **Step 5: 运行白名单契约测试**

运行：`node --test tests/script-protagonist-generation-contract.test.js`

预期：通过。

### Task 4: 全量验证与发布构建

**Files:**
- Modify: 仅为修复验证发现的问题修改上述文件。

- [ ] **Step 1: 运行定向回归测试**

运行：

```powershell
node --test tests/script-entity-management.test.js tests/script-entity-ui-contract.test.js tests/script-protagonist-generation-contract.test.js tests/script-draft-persistence-contract.test.js
```

预期：全部通过。

- [ ] **Step 2: 执行前端生产构建**

运行：`npm --prefix frontend run build`

预期：Vite 构建成功。

- [ ] **Step 3: 检查修改文件诊断**

检查 `ScriptPage.jsx`、`scriptEntities.js`、`scriptDraftStorage.js`、`generation.js`、`chat.js` 和 `global.css`，预期无诊断错误。

- [ ] **Step 4: 浏览器验收**

在剧本生成页验收：人物区和场景区都显示添加按钮；人物星标可切换；新增、编辑、删除会更新列表；删除主角会取消其白名单；生成请求只包含仍存在的主角；场景卡没有星标。

## 自检

- 规格覆盖：任务 1 覆盖稳定 ID 与草稿兼容；任务 2 覆盖所有界面维护操作；任务 3 覆盖请求、服务端过滤与提示词约束；任务 4 覆盖构建和验收。
- 占位符检查：计划不含 TBD、TODO 或未定义的实现步骤。
- 接口一致性：`normalizeExtractInfo`、`entityData`、`toGenerationEntities` 在任务 1 定义，任务 2 和任务 3 消费；`protagonists` 在前端 API 和后端消息构建中使用同名字段。
