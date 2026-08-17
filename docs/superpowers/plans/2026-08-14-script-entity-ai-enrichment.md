# 剧本人物与场景智能补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 在剧本生成页的人物和场景编辑器中增加基于小说原文的 AI 智能补全，并保证人工非空字段不被覆盖。

**Architecture:** 新增 `entity_enrich` 作为 `/api/chat` 的受限请求类型：服务端从已发布提取预设构建原文优先的 JSON 协议，校验输入并只返回建议，不持久化。前端在现有 `EntityEditor` 本地编辑状态中调用该接口，以“仅填空”规则合并 `fields`，将原文依据、AI 建议和不确定项独立显示；现有实体保存、草稿和剧本生成转换保持不变。

**Tech Stack:** React、Ant Design、Node.js、Express、Node 内置 `node:test`、现有系统预设目录和 `/api/chat` 上游代理。

## Global Constraints

- 仅修改剧本生成页、`scriptEntities` 数据转换、前端生成 API 与 `/api/chat` 的现有 AI 请求链路。
- 不新增服务端实体库、项目级人物资产、小说面板功能、跨项目共享实体或新的持久化 API。
- AI 以小说原文为主要依据；已有实体卡仅提供摘要上下文，防止重名、冲突或重复设定。
- 用户手动填写的非空字段不得被 AI 自动覆盖；AI 仅填充空字段，冲突写入 `suggestions`。
- 无法从原文确定的内容必须写入 `uncertainties`，不得作为原文事实填入实体字段。
- 智能补全结果只在弹窗本地状态存在；用户点击既有保存后才写入账号本地草稿。
- 使用当前账号 AI 配置、现有认证、限流和上游错误处理；不记录 API Key、小说原文、完整实体正文或上游原始错误。
- 不新增第三方依赖；不覆盖用户已有未提交修改；不创建 Git 提交，除非用户明确要求。

---

## 文件结构

- 创建 `frontend/src/user/pages/scriptEntityEnrichment.js`：纯函数，负责字段保护、摘要压缩和模型结果归一化。
- 修改 `frontend/src/shared/api/generation.js`：新增 `enrichScriptEntity()` 请求封装。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：在现有 `EntityEditor` 注入智能补全按钮、本地请求状态、只读结果区和仅填空合并。
- 修改 `routes/chat.js`：校验 `entity_enrich` 请求、组装消息、解析建议并返回安全 JSON。
- 创建 `tests/script-entity-enrichment.test.js`：纯函数、API 消息、输入拒绝、AI JSON 解析测试。
- 修改 `tests/script-entity-ui-contract.test.js`：工作台结构静态合约。
- 修改 `tests/script-constraints.test.js`：确保 `buildMessages` 新分支不影响 script/constraint 生成。

### Task 1: 建立前端实体建议归一化与人工字段保护

**Files:**
- Create: `frontend/src/user/pages/scriptEntityEnrichment.js`
- Create: `tests/script-entity-enrichment.test.js`

**Interfaces:**
- Produces: `entityName(data)`, `compactEntitySummary(extractInfo, entityId)`, `normalizeEntityEnrichment(value)`, `applyEntityEnrichment(fields, enrichment)`。
- Consumes: `normalizeExtractInfo()` 和 `entityData()` 的已有实体记录结构。

- [ ] **Step 1: 写入“只填空字段”失败测试**

```js
test('entity enrichment only fills empty fields and preserves manual values', async () => {
  const { applyEntityEnrichment } = await import('../frontend/src/user/pages/scriptEntityEnrichment.js');
  const result = applyEntityEnrichment(
    { 名称: '林薇', 身份: '小三', 外形: '', 性格: '' },
    { fields: { 名称: '林秘书', 身份: '秘书', 外形: '黑色长卷发', 性格: '善于伪装' } }
  );
  assert.deepEqual(result, { 名称: '林薇', 身份: '小三', 外形: '黑色长卷发', 性格: '善于伪装' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-entity-enrichment.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现安全纯函数**

实现以下规则：

```js
export function entityName(data) {
  return String(data?.角色名称 || data?.场景名称 || data?.名称 || data?.name || '').trim();
}

export function applyEntityEnrichment(fields, enrichment) {
  const current = fields && typeof fields === 'object' ? { ...fields } : {};
  const suggested = enrichment?.fields && typeof enrichment.fields === 'object' ? enrichment.fields : {};
  for (const [key, value] of Object.entries(suggested)) {
    if (!String(current[key] ?? '').trim() && typeof value === 'string' && value.trim()) current[key] = value.trim();
  }
  return current;
}
```

`normalizeEntityEnrichment()` 只保留 `fields`（最多 12 个键，每值最多 4000 字符）、`evidence`、`suggestions`、`uncertainties`（每个数组最多 12 项、每项最多 1000 字符）。`compactEntitySummary()` 从当前实体中排除正在编辑的 ID，最多保留 20 人物和 20 场景，每项只保留前 800 字符的原始字段。

- [ ] **Step 4: 增加人物、场景和不确定项归一化测试**

```js
test('normalizes enrichment display data and excludes edited entity from context summary', async () => {
  const { compactEntitySummary, normalizeEntityEnrichment } = await import('../frontend/src/user/pages/scriptEntityEnrichment.js');
  const summary = compactEntitySummary({
    characters: [{ id: 'editing', data: { 名称: '林薇' } }, { id: 'other', data: { 名称: '顾沉', 身份: '总裁' } }],
    scenes: [{ id: 'scene', data: { 名称: '酒店套房' } }]
  }, 'editing');
  assert.deepEqual(summary.characters, [{ 名称: '顾沉', 身份: '总裁' }]);
  assert.deepEqual(summary.scenes, [{ 名称: '酒店套房' }]);
  assert.deepEqual(normalizeEntityEnrichment({ evidence: ['原文第 3 段'], uncertainties: ['关系未明'] }).uncertainties, ['关系未明']);
});
```

- [ ] **Step 5: 运行模块测试确认通过**

Run: `node --test tests/script-entity-enrichment.test.js tests/script-entity-management.test.js`

Expected: PASS。

### Task 2: 实现受限的 entity_enrich 服务端协议

**Files:**
- Modify: `routes/chat.js`
- Modify: `tests/script-entity-enrichment.test.js`
- Modify: `tests/script-constraints.test.js`

**Interfaces:**
- Consumes: `resolveExtractionPresetId()`、`resolveSystemPresetBody()`、现有 `readConfig()`、`requestUpstream()`。
- Produces: `validateEntityEnrichmentBody(body)`、`buildEntityEnrichmentMessages(body, presetStore)`、`parseEntityEnrichment(text)`；`POST /api/chat` 支持 `promptType: 'entity_enrich'`。

- [ ] **Step 1: 写入实体补全消息失败测试**

```js
test('builds entity enrichment messages from a published extraction preset with manual-field protection', () => {
  const messages = chat._private.buildEntityEnrichmentMessages({
    entityType: 'character', novelText: '林薇走进办公室。',
    entity: { 名称: '林薇', 身份: '小三', 外形: '' },
    existingEntitySummary: { characters: [{ 名称: '顾沉' }], scenes: [] },
    extractionPreset: 'script-extract-current'
  }, presetStore);
  assert.match(messages[0].content, /小说原文为主要依据/);
  assert.match(messages[0].content, /不得覆盖用户已填写的非空字段/);
  assert.match(messages[0].content, /uncertainties/);
  assert.match(messages[1].content, /林薇走进办公室/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-entity-enrichment.test.js`

Expected: FAIL，`buildEntityEnrichmentMessages` 未定义。

- [ ] **Step 3: 实现输入验证与消息构建**

定义常量：小说原文最多 120000 字符；实体最多 12 个字段、每字段名 80 字符、值 4000 字符；摘要人物和场景分别最多 20 项；每摘要实体经 JSON 序列化最多 800 字符。

`validateEntityEnrichmentBody(body)` 必须：

1. 仅接受 `entityType === 'character' || entityType === 'scene'`；
2. 要求 `novelText.trim()` 非空；
3. 要求从实体 `角色名称/场景名称/名称/name` 中至少得到一个非空名称；
4. 使用 `resolveExtractionPresetId()` 获取当前已发布提取预设，未获取到时抛出 `No published extraction preset available`；
5. 返回已清洗的 body，不保留未知顶层字段。

`buildEntityEnrichmentMessages()` 以当前提取预设正文为基础，增加严格 JSON 契约：

```text
小说原文为主要依据；现有卡摘要仅用于避免重复或冲突。
不得覆盖用户已填写的非空字段；对冲突判断写入 suggestions。
没有原文依据的内容必须写入 uncertainties，不得作为事实写入 fields。
只返回 JSON：fields、evidence、suggestions、uncertainties。
```

- [ ] **Step 4: 实现 response 解析与聊天分支**

`parseEntityEnrichment(text)` 必须解析纯 JSON 或 Markdown JSON 围栏；非对象、字段类型错误或 JSON 无效均抛出 `Entity enrichment response must be valid JSON`。

在 `/chat` 的非流式上游成功路径，若 `promptType === 'entity_enrich'`，将模型的 `choices[0].message.content` 解析后返回：

```json
{ "enrichment": { "fields": {}, "evidence": [], "suggestions": [], "uncertainties": [] } }
```

该分支只返回 JSON，不调用任何草稿或实体持久化代码。`buildMessages()` 对该类型返回 `buildEntityEnrichmentMessages()`；其他 promptType 维持现状。

- [ ] **Step 5: 增加验证/解析/回归测试并运行通过**

测试：非法 `entityType`、空原文、缺名称、超过输入限制和无已发布预设均会在上游请求前抛出；JSON 围栏可解析；script/extract 消息仍按原有结构构建。

Run:

```powershell
node --test tests/script-entity-enrichment.test.js tests/script-constraints.test.js tests/script-extraction-presets.test.js
```

Expected: PASS。

### Task 3: 添加前端 API 封装与编辑器智能补全交互

**Files:**
- Modify: `frontend/src/shared/api/generation.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-entity-ui-contract.test.js`
- Modify: `tests/script-entity-enrichment.test.js`

**Interfaces:**
- Consumes: `enrichScriptEntity(input)`、Task 1 的纯函数、Task 2 的 `{ enrichment }` API 响应。
- Produces: `EntityEditor` 的智能补全操作、只读结果区和保存前可编辑草稿。

- [ ] **Step 1: 写入 API 请求失败测试**

```js
test('entity enrichment client posts only the dedicated entity_enrich request contract', async () => {
  const source = await fs.promises.readFile('frontend/src/shared/api/generation.js', 'utf8');
  assert.match(source, /export function enrichScriptEntity/);
  assert.match(source, /promptType:\s*'entity_enrich'/);
  assert.match(source, /entityType/);
  assert.match(source, /existingEntitySummary/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-entity-enrichment.test.js`

Expected: FAIL，API 函数未定义。

- [ ] **Step 3: 添加前端 API 封装**

在 `generation.js` 新增：

```js
export function enrichScriptEntity({ entityType, novelText, entity, existingEntitySummary, extractionPreset }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'entity_enrich', entityType, novelText, entity, existingEntitySummary, extractionPreset,
      max_tokens: 1800, temperature: 0.2, stream: false
    })
  });
}
```

- [ ] **Step 4: 在 ScriptPage 传入智能补全上下文**

在实体编辑弹窗开启时，将以下 props 传给 `EntityEditor`：

- 当前类型 `character` / `scene`；
- `form.getFieldValue('novelText')`；
- 当前提取预设 `selectAvailableExtractionPreset(form.getFieldValue('extractionPreset'), extractionPresets)`；
- `compactEntitySummary(extractInfo, activeEntity.id)`；
- `enrichScriptEntity`；
- `applyEntityEnrichment` 和 `normalizeEntityEnrichment`。

对于新增实体，摘要排除 ID 为空字符串，保留已有卡；对于编辑实体，摘要排除当前实体自身。

- [ ] **Step 5: 在 EntityEditor 实现本地请求和结果显示**

新增 state：`enriching`、`enrichment`、`enrichmentError`。按钮文本为“根据小说智能补全”；只有小说原文和当前实体名称非空时可用。调用成功后：

```js
const result = normalizeEntityEnrichment(response.enrichment);
setFields(current => applyEntityEnrichment(current, result));
setEnrichment(result);
```

渲染三个只读区：“原文依据”“AI 建议”“不确定项”。请求失败只展示错误，不关闭编辑器、不改变 `fields`。实体保存继续只调用已有 `onSave(fields)`。

- [ ] **Step 6: 更新 UI 合约并运行通过**

在 `script-entity-ui-contract.test.js` 断言 `根据小说智能补全`、`AI 建议`、`不确定项`、`enrichScriptEntity` 和 `applyEntityEnrichment` 存在，同时保留现有添加/编辑/删除/星标断言。

Run:

```powershell
node --test tests/script-entity-enrichment.test.js tests/script-entity-ui-contract.test.js tests/script-entity-management.test.js tests/script-draft-persistence-contract.test.js
```

Expected: PASS。

### Task 4: 完整回归与手工验证

**Files:**
- Test: `tests/script-entity-enrichment.test.js`
- Test: `tests/script-entity-management.test.js`
- Test: `tests/script-entity-ui-contract.test.js`
- Test: `tests/script-protagonist-generation-contract.test.js`
- Test: `tests/script-draft-persistence-contract.test.js`
- Test: `tests/script-extraction-presets.test.js`
- Test: `tests/script-extraction-preset-ui-contract.test.js`
- Test: `tests/script-constraints.test.js`

**Interfaces:**
- Consumes: 已完成的 enrichment API、编辑器交互、现有实体生成链路。
- Produces: 已验证的剧本页人物/场景智能补全功能。

- [ ] **Step 1: 运行完整剧本实体与生成契约测试**

Run:

```powershell
node --test tests/script-entity-enrichment.test.js tests/script-entity-management.test.js tests/script-entity-ui-contract.test.js tests/script-protagonist-generation-contract.test.js tests/script-draft-persistence-contract.test.js tests/script-extraction-presets.test.js tests/script-extraction-preset-ui-contract.test.js tests/script-constraints.test.js
```

Expected: PASS。

- [ ] **Step 2: 查看 package scripts 并执行已有检查**

Run:

```powershell
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"
```

运行其中存在的 lint、typecheck 和生产构建命令；不要猜测不存在的脚本。

- [ ] **Step 3: 手工验证人物补全**

1. 打开 `/script`，输入小说原文，新增人物。
2. 填写“名称：林薇”“身份：小三”，保持“外形”“性格”为空。
3. 点击“根据小说智能补全”。
4. 确认名称和身份仍为人工值；仅空字段被填入；若 AI 判断存在身份冲突，信息显示在“AI 建议”。
5. 点击保存，确认人物卡出现；星标主角仍可工作。

- [ ] **Step 4: 手工验证场景补全与生成回归**

1. 新增“酒店套房”，填写用途，保留时段/氛围/描述为空。
2. 补全后确认用途不变，空字段可编辑填充，依据/不确定项可见。
3. 保存场景，确认旧输出被清空，状态回退到已提取。
4. 生成剧本，确认人物、场景和主角白名单仍随现有请求发送。
5. 清空小说原文或实体名称，确认补全按钮不可用。

- [ ] **Step 5: 最终静态检查与变更范围审核**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` 无输出；变更仅涉及计划列出的剧本前端、聊天路由、测试和设计/计划文档。不要执行 Git 提交，除非用户明确要求。
