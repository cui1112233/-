# 剧本生成分段开头、分镜模式与约束设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为剧本生成加入小说面板提取方案、分段开头、分镜模式和可持久化的约束设置，同时保留现有连续开头、爆款开头及三种格式的行为。

**Architecture:** 继续通过现有 `/api/chat` 完成一次人物场景提取和一次文本生成。后端使用显式白名单将提取方案、策略和格式映射到系统预设词；“分段开头”由 V77 工具规则提炼后的策略预设与选定格式预设组合。用户端将约束配置保存在现有账号级剧本草稿中，生成时发送给后端；后端只在画布、剧情和分镜模式中将约束作为最终文本包裹规则注入，剧本模式无条件忽略。

**Tech Stack:** React、Ant Design、Node.js、Express、node:test、现有系统预设词存储。

## Global Constraints

- 规则迁移源必须是 `F:\脚本测试\chengming\视频画面提示词工具_CharacterCore2当前风格保留与人物卡非阻拦版_v77_Hotfix26_20260812` 的实际运行时提示词分层。
- 剧本生成保持两次 AI 请求：人物/场景提取一次，剧本/分镜生成一次；不得接入 CharacterCore、多轮补镜或小说面板质量闸门。
- `mode: segmented`、`format: shotlist`、提取方案 ID 和约束类别均必须使用显式白名单；非法值回退到既有默认值。
- 输出模式 `shortdrama`（剧本模式）不得显示、发送或注入约束；后端必须忽略恶意或残留请求中的约束对象。
- 10s / 15s 维持当前选择控件；分段开头中，每一个独立剧情单元从 `00:00` 开始，末镜必须到所选时长。
- 约束默认关闭；启用后可选择零到四个类别；不得生成空的约束标题。
- 系统预设只允许具有相应后台权限的用户编辑和发布；普通用户只读取公开目录元数据，用户编辑保存为当前账号草稿中的自定义内容，不覆盖系统预设。
- 不提交 Git 变更，除非用户明确要求。

---

## 文件与职责

| 文件 | 责任 |
|---|---|
| `prompts/小说面板人物场景提取.md` | 将 V77 内容类型、统一风格、人物/关系/阶段与场景语义转换为剧本页面可解析的人物与场景 JSON。 |
| `prompts/分段开头.md` | V77 语义迁移后的剧情单元切分、跨段连续、卡点与时长策略。 |
| `prompts/分镜模式.md` | 以小说面板最终导出文本为目标的分镜格式规则。 |
| `prompts/约束设置.md` | 允许格式下的约束输出包裹协议；不含用户选择的具体词正文。 |
| `lib/system-preset-catalog.js` | 注册新增剧本基础预设和初始约束系统预设。 |
| `routes/chat.js` | 提取方案/策略/格式/约束的请求白名单、提示词组装和约束注入。 |
| `routes/history.js` | 三种策略和四种格式的历史文本中文名称。 |
| `frontend/src/shared/api/generation.js` | 传递提取方案和约束配置。 |
| `frontend/src/user/pages/scriptDraftStorage.js` | 将草稿版本提升并迁移旧草稿，使新选择和约束配置可恢复。 |
| `frontend/src/user/pages/ScriptPage.jsx` | 指令切换与约束设置的 UI、表单状态、草稿、请求和模式禁用逻辑。 |
| `frontend/src/shared/styles/global.css` | 指令/约束控件的局部布局和响应式样式。 |
| `frontend/src/admin/pages/PresetLibraryPage.jsx` | 系统约束预设的类别标识、创建、筛选与可识别展示。 |
| `frontend/src/admin/pages/PromptStrategyPage.jsx` | 展示分段开头和分镜模式。 |
| `tests/system-preset-catalog.test.js` | 系统预设种子数、V77 预设、请求组装与约束服务端规则。 |
| `tests/script-draft-persistence-contract.test.js` | 草稿迁移、约束和选择恢复契约。 |
| `tests/script-page-contract.test.js` | 剧本页策略、格式、指令切换、约束禁用与请求参数契约。 |

## 系统预设 ID 与约束数据契约

### 基础预设

```js
const SCRIPT_EXTRACTION_PRESET_IDS = {
  standard: 'script-extract',
  novelPanel: 'script-extract-novel-panel'
};

const SCRIPT_MODE_PRESET_IDS = {
  continuous: 'script-continuous',
  hook: 'script-hook',
  segmented: 'script-segmented'
};

const SCRIPT_FORMAT_PRESET_IDS = {
  screenplay: 'script-format-screenplay',
  storyboard: 'script-format-storyboard',
  shortdrama: 'script-format-shortdrama',
  shotlist: 'script-format-shotlist'
};
```

### 约束系统预设 ID

系统约束使用 `script` 模块下 `kind: 'addon'` 的预设，以 ID 前缀区分类型。它们**不会**自动追加到所有剧本请求，只有后端收到被选中的 ID 时才解析正文。

```js
const SCRIPT_CONSTRAINT_PREFIXES = {
  prefix: 'script-constraint-prefix-',
  quality: 'script-constraint-quality-',
  restriction: 'script-constraint-restriction-',
  negative: 'script-constraint-negative-'
};
```

初始种子：

```text
script-constraint-prefix-live-action       真人实拍
script-constraint-prefix-3d                3D 国漫
script-constraint-prefix-2d                2D 动漫
script-constraint-prefix-guoman            国漫
script-constraint-quality-4k               4K 画质
script-constraint-restriction-no-overlay   无关文字限制
script-constraint-negative-general         通用负面提示词
```

### 客户端配置

```js
const DEFAULT_SCRIPT_CONSTRAINTS = {
  enabled: false,
  prefix: { presetId: '', customText: '' },
  quality: { presetId: '', customText: '' },
  restriction: { presetId: '', customText: '' },
  negative: { presetId: '', customText: '' }
};
```

规则：`customText.trim()` 非空时优先于 `presetId`；`presetId` 只能在后端允许的类别前缀中解析；`enabled: false` 时所有层均不注入；`shortdrama` 时忽略整对象。

### 提取方案与约束目录

新增公开目录请求：

```text
GET /api/presets?module=script
```

该接口只返回 `publicPreset` 元数据，因而普通用户不可读取系统预设正文。为让用户能选择系统约束，前端只用其 ID、名称、说明和类别前缀构建选项；真实正文仅由后端在生成请求中解析。

---

### Task 1: 建立预设与 V77 迁移内容

**Files:**
- Create: `prompts/小说面板人物场景提取.md`
- Create: `prompts/分段开头.md`
- Create: `prompts/分镜模式.md`
- Create: `prompts/约束设置.md`
- Modify: `lib/system-preset-catalog.js:6-63`
- Modify: `tests/system-preset-catalog.test.js:18-98`

**Interfaces:**
- Produces `script-extract-novel-panel`、`script-segmented`、`script-format-shotlist` 基础预设。
- Produces按 `SCRIPT_CONSTRAINT_PREFIXES` 命名的系统 `addon` 预设。
- Consumers: `routes/chat.js` 使用这些 ID 组装提取和生成请求；管理后台使用预设元信息显示系统内容。

- [ ] **Step 1: 写失败的系统预设种子测试**

在 `tests/system-preset-catalog.test.js` 新增测试，断言系统种子包含新增基础预设和约束预设，且正文可被解析：

```js
test('seeds V77-derived extraction, segmented, shotlist and constraint presets', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');

  assert.ok(store.getPublished('script-extract-novel-panel'));
  assert.ok(store.getPublished('script-segmented'));
  assert.ok(store.getPublished('script-format-shotlist'));
  assert.ok(store.getPublished('script-constraint-prefix-3d'));
  assert.ok(store.getPublished('script-constraint-quality-4k'));
  assert.ok(store.getPublished('script-constraint-restriction-no-overlay'));
  assert.ok(store.getPublished('script-constraint-negative-general'));
  assert.match(resolveSystemPresetBody(store, 'script-segmented'), /剧情单元/);
  assert.match(resolveSystemPresetBody(store, 'script-format-shotlist'), /镜头画面/);
});
```

同时把旧测试标题“ten fixed server-only defaults”和剧本模块固定数量断言改成依据新增总数的准确值；不要继续保留 `7`、`10` 这类过期魔法数字。

- [ ] **Step 2: 运行测试并确认失败原因是新增预设不存在**

Run:

```powershell
node --test tests/system-preset-catalog.test.js
```

Expected: FAIL，提示 `script-extract-novel-panel` 或其他新增预设不存在。

- [ ] **Step 3: 从 V77 工具迁移并写入四份提示词文件**

在四个新文件中使用以下明确职责，不复制 V77 的 JSON 字段、槽位 ID、逐行卡片或 API 机制：

1. `小说面板人物场景提取.md`
   - 迁移 `character-core.js::buildStyleOnlyPrompt` 的全文内容类型、时代、世界观、核心关系、冲突、叙事发动机、情绪和十一项统一风格语义；
   - 迁移 `buildFactsPrompt` 的人物事实、别名、第一人称映射、关系、人物阶段和证据优先级；
   - 输出兼容现有 `normalizeExtraction` 的顶层对象，必须包含 `人物设定` 和 `场景设定`；
   - 人物项包含 `角色名称`、`别名`、`角色定位`、`身份标签`、`关系网络`、`说话风格`、`年龄阶段`、`外观描述`；
   - 场景项包含 `场景名称`、`时间`、`情绪基调`、`氛围概述`、`场景描述`；
   - 只返回合法 JSON，不输出 Markdown。

2. `分段开头.md`
   - 使用 V77 `DEFAULT_AI_INSTRUCTIONS.outline`、`DIRECTOR_RHYTHM_RULES`、`SOURCE_TO_VISUAL_REASONING_SKILL` 的语义；
   - 从原文开头按剧情单元切分，触发条件为时空/主体目标/动作阶段/关键道具/信息/对白反应/关系可见变化；
   - 每单元建立、推进、卡点；跨单元保持人物阶段、服装、道具、空间、朝向、光线、情绪连续；
   - 当前原文优先，只有明确承接时才继承上一单元场景；
   - 空镜/物件镜、临时人物、信息载体、对白唯一归属的语义必须保留；
   - 明确 `{duration}` 是每个独立单元总时长，末镜到达该时长；不得重复镜头凑时长；
   - 只输出格式预设所规定的成品文本。

3. `分镜模式.md`
   - 使用 V77 `DEFAULT_STYLE.camera`、`DIRECTOR_MUST_COVER_RULES`、`DIRECTOR_RHYTHM_RULES`、`COMPLETE_VISUAL_BODY_SKILL`、`SCENE_AND_SUBSCENE_SKILL`、`DIALOGUE_DEDUP_SKILL` 的纯文本语义；
   - 输出一个或多个独立单元，每单元严格使用：`统一风格`、`统一人物`、`镜头画面`；
   - 镜头行为：`00:00-00:XX | 景别 - 机位/角度 - 运镜 - 转场 | 画面正文`；
   - 有可确认口语对白时才在对应画面后另起行输出 `人物名（动作/语气）：“原文台词”`；
   - `10s` 末镜必须为 `00:10`、`15s` 为 `00:15`；
   - 不输出 JSON、字段名、分析过程或“第 N 段”标题。

4. `约束设置.md`
   - 只定义输出包裹顺序：画面前缀与画质/限制在主体格式之前，负面提示词在主体之后；
   - 明确仅输出有值类别，禁止空标签；
   - 明确系统、聊天、合同、弹幕、监控等原文明示信息载体可以保留必要文字；其他文字、水印、Logo、无关 UI 由用户选中的约束文本控制；
   - 不把具体系统约束词硬编码进策略或格式预设。

- [ ] **Step 4: 注册基础预设和显式约束种子**

修改 `lib/system-preset-catalog.js`：

```js
const SCRIPT_PRESETS = [
  ['script-extract', '人物场景提取', '剧本标准人物与场景提取规则', '人物场景提取.md'],
  ['script-extract-novel-panel', '小说面板提取', 'V77 小说面板人物、关系、场景与统一风格提取规则', '小说面板人物场景提取.md'],
  ['script-hook', '爆款开头', '剧本爆点开头策略', '爆款开头.md'],
  ['script-continuous', '连续开头', '连续剧情开头策略', '连续开头.md'],
  ['script-segmented', '分段开头', 'V77 剧情单元自动分段连续策略', '分段开头.md'],
  ['script-general', '通用规则', '剧本生成通用约束', '通用规则.md'],
  ['script-format-screenplay', '剧情模式', '剧情模式输出格式', '剧情模式.md'],
  ['script-format-storyboard', '画布模式', '画布模式输出格式', '画布模式.md'],
  ['script-format-shortdrama', '剧本模式', '短剧模式输出格式', '剧本模式.md'],
  ['script-format-shotlist', '分镜模式', 'V77 小说面板式最终分镜输出格式', '分镜模式.md'],
  ['script-constraint-wrapper', '约束设置规则', '允许格式下的约束输出包裹规则', '约束设置.md']
].map(/* preserve existing mapper */);
```

新增 `SCRIPT_CONSTRAINT_PRESETS` 对象数组，以 `kind: 'addon'`、`module: 'script'`、指定 `id`、`name`、`description`、`body` 和 `protocolLock: { format: 'constraint', category: '<category>' }` 创建初始约束种子。

修改 `resolveSystemPresetBody()` 的 addon 过滤条件：只自动追加 `protocolLock.format !== 'constraint'` 的已发布 addon。这样普通剧本 addon 维持当前自动追加行为，而约束 addon 不会泄漏进未选择约束的请求；下一任务由 `routes/chat.js` 按用户选择的 ID 显式解析约束正文。

调整 `SYSTEM_PRESETS` 构建逻辑，使基础预设保持 `kind: 'base'`，约束预设保持自己的 `kind: 'addon'`，并保留各自 `compatibleBaseIds`。

- [ ] **Step 5: 运行预设测试并确认通过**

Run:

```powershell
node --test tests/system-preset-catalog.test.js
```

Expected: PASS，现有“发布版本覆盖”“通用 addon 自动追加”等测试继续通过。

---

### Task 2: 后端实现请求白名单、分段开头和约束注入

**Files:**
- Modify: `routes/chat.js:11-87`
- Modify: `routes/history.js:24-53`
- Modify: `tests/system-preset-catalog.test.js:44-98`
- Create: `tests/script-generation-message-contract.test.js`

**Interfaces:**
- Consumes `SCRIPT_EXTRACTION_PRESET_IDS`、`SCRIPT_MODE_PRESET_IDS`、`SCRIPT_FORMAT_PRESET_IDS` 与系统约束 ID。
- Produces `buildExtractMessages(body, presetStore)` 和 `buildScriptMessages(body, presetStore)` 的已验证 messages。
- `buildScriptMessages` 接受：`{ mode, format, duration, novelText, characters, scenes, constraints }`。
- `buildExtractMessages` 接受：`{ novelText, extractionPreset }`。

- [ ] **Step 1: 写后端消息组装失败测试**

创建 `tests/script-generation-message-contract.test.js`，用临时 preset store 种子验证以下行为：

```js
test('uses selected novel-panel extraction preset and falls back to standard extraction', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');

  const selected = chatRouter._private.buildExtractMessages({
    novelText: '原文',
    extractionPreset: 'novelPanel'
  }, store);
  const fallback = chatRouter._private.buildExtractMessages({
    novelText: '原文',
    extractionPreset: 'unexpected'
  }, store);

  assert.match(selected[0].content, /十一项统一风格/);
  assert.match(fallback[0].content, /人物场景提取/);
});

test('uses segmented strategy and shotlist format with the selected duration', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');
  const messages = chatRouter._private.buildScriptMessages({
    mode: 'segmented', format: 'shotlist', duration: '15s', novelText: '原文',
    characters: [{ 角色名称: '甲' }], scenes: [{ 场景名称: '客厅' }]
  }, store);

  assert.match(messages[0].content, /剧情单元/);
  assert.match(messages[0].content, /统一风格/);
  assert.match(messages[0].content, /00:15/);
  assert.match(messages[1].content, /人物信息/);
  assert.match(messages[1].content, /场景信息/);
});

test('injects selected constraints around allowed formats but never for shortdrama', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');
  const constraints = {
    enabled: true,
    prefix: { presetId: 'script-constraint-prefix-3d', customText: '' },
    quality: { presetId: 'script-constraint-quality-4k', customText: '' },
    restriction: { presetId: 'script-constraint-restriction-no-overlay', customText: '' },
    negative: { presetId: 'script-constraint-negative-general', customText: '' }
  };

  const allowed = chatRouter._private.buildScriptMessages({
    mode: 'segmented', format: 'shotlist', duration: '10s', novelText: '原文', characters: [], scenes: [], constraints
  }, store);
  const blocked = chatRouter._private.buildScriptMessages({
    mode: 'segmented', format: 'shortdrama', duration: '10s', novelText: '原文', characters: [], scenes: [], constraints
  }, store);

  assert.match(allowed[0].content, /【画面前缀】/);
  assert.match(allowed[0].content, /【画质约束】/);
  assert.match(allowed[0].content, /负面提示词/);
  assert.doesNotMatch(blocked[0].content, /【画面前缀】/);
  assert.doesNotMatch(blocked[0].content, /负面提示词/);
});
```

- [ ] **Step 2: 运行新增测试并确认失败**

Run:

```powershell
node --test tests/script-generation-message-contract.test.js
```

Expected: FAIL，因为当前 `chat.js` 只支持二元策略、三种格式和固定提取预设。

- [ ] **Step 3: 在 `routes/chat.js` 建立常量和纯函数**

在文件顶部替换旧的 `FORMAT_FILE_MAP`/二元 mode 写法，建立：

```js
const EXTRACTION_PRESET_ID_MAP = {
  standard: 'script-extract',
  novelPanel: 'script-extract-novel-panel'
};

const MODE_PRESET_ID_MAP = {
  continuous: 'script-continuous',
  hook: 'script-hook',
  segmented: 'script-segmented'
};

const FORMAT_PRESET_ID_MAP = {
  screenplay: 'script-format-screenplay',
  storyboard: 'script-format-storyboard',
  shortdrama: 'script-format-shortdrama',
  shotlist: 'script-format-shotlist'
};

const FORMAT_NAME_MAP = {
  screenplay: '剧情模式',
  storyboard: '画布模式',
  shortdrama: '剧本模式',
  shotlist: '分镜模式'
};

const CONSTRAINT_CATEGORY_PREFIXES = {
  prefix: 'script-constraint-prefix-',
  quality: 'script-constraint-quality-',
  restriction: 'script-constraint-restriction-',
  negative: 'script-constraint-negative-'
};
```

增加以下纯函数并导出到 `router._private`：

```js
function normalizeExtractionPreset(value) {
  return Object.hasOwn(EXTRACTION_PRESET_ID_MAP, value) ? value : 'standard';
}

function normalizeMode(value) {
  return Object.hasOwn(MODE_PRESET_ID_MAP, value) ? value : 'continuous';
}

function normalizeFormat(value) {
  return Object.hasOwn(FORMAT_PRESET_ID_MAP, value) ? value : 'screenplay';
}

function normalizeDuration(value) {
  return value === '15s' ? '15s' : '10s';
}
```

- [ ] **Step 4: 实现提取方案选择和格式变量替换**

更新 `buildExtractMessages`：

```js
function buildExtractMessages(body, presetStore) {
  const extractionPreset = normalizeExtractionPreset(body.extractionPreset);
  const systemPrompt = resolveSystemPresetBody(presetStore, EXTRACTION_PRESET_ID_MAP[extractionPreset]);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请分析以下小说章节：\n\n${String(body.novelText || '')}` }
  ];
}
```

在 `buildScriptMessages` 中按映射选择策略和格式预设。除保留既有 `{10s或15s}`、`{X}`、`{2X}` 替换外，新增：

```js
formatContent = formatContent
  .replace(/\{duration\}/g, duration)
  .replace(/\{结束时间\}/g, duration === '15s' ? '00:15' : '00:10');
```

不要使用 `readPromptFile`，该函数在预设系统建立后不参与请求组装，应删除未使用的 `fs`/`path` 导入和函数，避免存在两套读取来源。

- [ ] **Step 5: 实现约束归一化和服务端文本包裹**

新增：

```js
function resolveConstraintText(presetStore, category, value) {
  const customText = String(value?.customText || '').trim();
  if (customText) return customText;
  const presetId = String(value?.presetId || '');
  const prefix = CONSTRAINT_CATEGORY_PREFIXES[category];
  if (!prefix || !presetId.startsWith(prefix)) return '';
  return resolveSystemPresetBody(presetStore, presetId).trim();
}

function buildConstraintWrapper(presetStore, constraints, format) {
  if (format === 'shortdrama' || constraints?.enabled !== true) return '';
  const prefix = resolveConstraintText(presetStore, 'prefix', constraints?.prefix);
  const quality = resolveConstraintText(presetStore, 'quality', constraints?.quality);
  const restriction = resolveConstraintText(presetStore, 'restriction', constraints?.restriction);
  const negative = resolveConstraintText(presetStore, 'negative', constraints?.negative);
  if (!prefix && !quality && !restriction && !negative) return '';

  return [
    resolveSystemPresetBody(presetStore, 'script-constraint-wrapper'),
    prefix && `【画面前缀】\n${prefix}`,
    (quality || restriction) && `【画质约束】\n${[quality, restriction].filter(Boolean).join('\n')}`,
    negative && `【负面提示词】\n${negative}`
  ].filter(Boolean).join('\n\n');
}
```

将 wrapper 放入 `systemPrompt`，并明确其是“最终输出包裹规则”：前缀与画质约束出现在当前格式主体之前，负面提示词出现在主体之后；仅输出有值区块。`shortdrama` 永远不添加 `script-constraint-wrapper` 或用户约束正文。

- [ ] **Step 6: 更新历史中文映射**

在 `routes/history.js` 顶部新增：

```js
const MODE_NAME_MAP = {
  continuous: '连续开头',
  hook: '爆款开头',
  segmented: '分段开头'
};
```

将文本文件头替换为：

```js
const modeName = MODE_NAME_MAP[mode] || MODE_NAME_MAP.continuous;
const header = `格式：${formatName || format}\n模式：${modeName}\n时长：${duration || '-'}\n生成时间：${new Date().toISOString()}\n${'='.repeat(40)}\n\n`;
```

- [ ] **Step 7: 运行后端测试并确认通过**

Run:

```powershell
node --test tests/system-preset-catalog.test.js tests/script-generation-message-contract.test.js
```

Expected: PASS。特别核对：`segmented + shotlist + 15s` 的 system message 同时包含分段策略、分镜格式和 `00:15`；`shortdrama` 不含任何约束标题。

---

### Task 3: 扩展公开预设目录和管理后台约束维护

**Files:**
- Modify: `routes/presets.js:18-24`
- Modify: `frontend/src/shared/api/admin.js`
- Modify: `frontend/src/admin/pages/PresetLibraryPage.jsx:5-175`
- Modify: `frontend/src/admin/pages/PromptStrategyPage.jsx:1-20`
- Create: `tests/constraint-preset-admin-contract.test.js`

**Interfaces:**
- Public catalog response remains metadata-only: `{ catalog: PublicPreset[] }`.
- Constraint metadata uses `protocolLock.category` for admin categorization; body is never exposed by public catalog.
- Admin creates constraints as `module: 'script'`, `kind: 'addon'`, with a `protocolLock.category` of `prefix|quality|restriction|negative`.

- [ ] **Step 1: 写管理目录失败测试**

创建 `tests/constraint-preset-admin-contract.test.js`：

```js
test('constraint presets expose metadata publicly but preserve their body for admins only', () => {
  const presetsRoute = read('routes/presets.js');
  const page = read('frontend/src/admin/pages/PresetLibraryPage.jsx');

  assert.match(presetsRoute, /listCatalog/);
  assert.match(page, /画面前缀词/);
  assert.match(page, /画质约束/);
  assert.match(page, /画面限制/);
  assert.match(page, /负面提示词/);
  assert.match(page, /protocolLock/);
});

test('strategy page lists segmented opening and shotlist format', () => {
  const page = read('frontend/src/admin/pages/PromptStrategyPage.jsx');
  assert.match(page, /分段开头/);
  assert.match(page, /分镜模式/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/constraint-preset-admin-contract.test.js
```

Expected: FAIL，当前管理页没有四个约束类别，也没有新策略/格式元信息。

- [ ] **Step 3: 确认并保持公开目录不泄露正文**

`routes/presets.js` 现有 `presetStore.listCatalog()` 已应返回公共元数据。检查 `lib/preset-store.js` 的 `listCatalog`/`publicPreset` 后，只在必要时使 `protocolLock.category` 和 `description` 可见；禁止把 `body` 加入 catalog 响应。

若 `protocolLock` 未被 `publicPreset` 返回，则只增加安全的 `constraintCategory` 字段：

```js
constraintCategory: preset.protocolLock?.category || ''
```

同时更新对应 `publicPreset` 单元测试，断言正文不存在。

- [ ] **Step 4: 为后台编辑器提供类别选择**

在 `PresetLibraryPage.jsx` 新增 `constraintCategories`：

```js
const constraintCategories = [
  { label: '画面前缀词', value: 'prefix' },
  { label: '画质约束', value: 'quality' },
  { label: '画面限制', value: 'restriction' },
  { label: '负面提示词', value: 'negative' }
];
```

在编辑 modal 中：

- 当模块为 `script` 且 `kind === 'addon'` 时显示“约束类别” Select；
- 保存时将所选类别合并进 `protocolLock`；
- 新建约束预设时，将 ID 校验为对应前缀，例如 category `prefix` 只接受 `script-constraint-prefix-` 开头；
- 普通 addon 仍可不选择类别，并维持当前“所有剧本请求自动追加”的行为；约束 addon 的 `description` 明确标注“仅当用户选择时注入”。

不要将约束系统正文提供给普通用户端。

- [ ] **Step 5: 更新策略展示**

在 `PromptStrategyPage.jsx` 的静态 `rows` 中添加：

```js
{ key: 'segmented', name: '分段开头', type: '叙事策略', status: '启用' },
{ key: 'shotlist', name: '分镜模式', type: '输出格式', status: '启用' }
```

- [ ] **Step 6: 运行管理契约和现有预设测试**

Run:

```powershell
node --test tests/constraint-preset-admin-contract.test.js tests/system-preset-catalog.test.js
```

Expected: PASS，且既有管理预设词测试仍通过。

---

### Task 4: 扩展客户端 API、草稿持久化和约束状态归一化

**Files:**
- Modify: `frontend/src/shared/api/generation.js:3-31`
- Modify: `frontend/src/user/pages/scriptDraftStorage.js:1-31`
- Create: `frontend/src/user/pages/scriptConstraints.js`
- Modify: `tests/script-draft-persistence-contract.test.js:9-27`
- Create: `tests/script-constraints-contract.test.js`

**Interfaces:**
- `extractCharactersAndScenes(novelText, extractionPreset)` sends `extractionPreset`.
- `generateScript({ mode, format, duration, novelText, characters, scenes, constraints })` sends `constraints`.
- `normalizeScriptConstraints(value)` returns `DEFAULT_SCRIPT_CONSTRAINTS` shape.
- Draft version becomes `2`, accepting/migrating version `1` drafts.

- [ ] **Step 1: 写纯约束状态失败测试**

创建 `tests/script-constraints-contract.test.js`，导入新的纯函数模块并测试：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCRIPT_CONSTRAINTS, normalizeScriptConstraints, constraintsForFormat } from '../frontend/src/user/pages/scriptConstraints.js';

test('normalizes missing and malformed constraints to disabled defaults', () => {
  assert.deepEqual(normalizeScriptConstraints(null), DEFAULT_SCRIPT_CONSTRAINTS);
  assert.deepEqual(normalizeScriptConstraints({ enabled: true, prefix: { presetId: 1 } }), {
    enabled: true,
    prefix: { presetId: '', customText: '' },
    quality: { presetId: '', customText: '' },
    restriction: { presetId: '', customText: '' },
    negative: { presetId: '', customText: '' }
  });
});

test('removes constraints for shortdrama but preserves them for allowed formats', () => {
  const enabled = { ...DEFAULT_SCRIPT_CONSTRAINTS, enabled: true, prefix: { presetId: '', customText: '3D' } };
  assert.equal(constraintsForFormat(enabled, 'shortdrama').enabled, false);
  assert.equal(constraintsForFormat(enabled, 'shotlist').prefix.customText, '3D');
});
```

If Node test runner cannot import the existing frontend ES module convention, create an equivalent CommonJS pure helper under `lib/` and import it from the frontend; use the project’s existing test/module conventions rather than adding a transpiler.

- [ ] **Step 2: 写草稿 v1 → v2 迁移失败测试**

扩展 `tests/script-draft-persistence-contract.test.js`，除了文本契约外，增加基于内存 storage 的行为测试：

```js
const storage = new Map();
const fakeStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };

fakeStorage.setItem('qiantie:script-draft:tester', JSON.stringify({
  version: 1,
  values: { mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '原文' },
  extractInfo: { characters: [], scenes: [] }
}));

const draft = loadScriptDraft(fakeStorage, 'tester');
assert.equal(draft.version, 2);
assert.equal(draft.values.extractionPreset, 'standard');
assert.equal(draft.constraints.enabled, false);
```

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
node --test tests/script-draft-persistence-contract.test.js tests/script-constraints-contract.test.js
```

Expected: FAIL，因为尚无 `scriptConstraints` 模块，草稿版本仍为 1。

- [ ] **Step 4: 实现纯约束模块与草稿迁移**

创建 `scriptConstraints.js`，导出：

```js
export const DEFAULT_SCRIPT_CONSTRAINTS = Object.freeze({
  enabled: false,
  prefix: { presetId: '', customText: '' },
  quality: { presetId: '', customText: '' },
  restriction: { presetId: '', customText: '' },
  negative: { presetId: '', customText: '' }
});

export function normalizeScriptConstraints(value) { /* clone only known string fields */ }

export function constraintsForFormat(value, format) {
  return format === 'shortdrama'
    ? { ...DEFAULT_SCRIPT_CONSTRAINTS }
    : normalizeScriptConstraints(value);
}
```

修改 `scriptDraftStorage.js`：

- `draftVersion = 2`；
- 接受 version 1 和 version 2；
- 读取 version 1 时填入：

```js
values: {
  ...draft.values,
  extractionPreset: draft.values.extractionPreset || 'standard'
},
constraints: normalizeScriptConstraints(draft.constraints)
```

- 保存时始终写 version 2；
- 不丢失当前 `extractInfo`、`output`、`editingOutput` 和 `generationStage`。

- [ ] **Step 5: 扩展 API 载荷**

修改 `generation.js`：

```js
export function extractCharactersAndScenes(novelText, extractionPreset = 'standard') {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ promptType: 'extract', novelText, extractionPreset, max_tokens: 4096, temperature: 0.3, stream: false })
  });
}

export function generateScript({ mode, format, duration, novelText, characters, scenes, constraints }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ promptType: 'script', mode, format, duration, novelText, characters, scenes, constraints, max_tokens: 8192, temperature: 0.7, stream: false })
  });
}
```

- [ ] **Step 6: 运行草稿和约束测试**

Run:

```powershell
node --test tests/script-draft-persistence-contract.test.js tests/script-constraints-contract.test.js
```

Expected: PASS，v1 草稿自动恢复为具备默认提取方案和默认关闭约束的 v2 形态。

---

### Task 5: 实现剧本页指令切换、策略/格式和约束设置 UI

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:1-570`
- Modify: `frontend/src/shared/api/generation.js:3-31`
- Modify: `frontend/src/shared/styles/global.css:889-1108`
- Create: `tests/script-page-contract.test.js`

**Interfaces:**
- Consumes `DEFAULT_SCRIPT_CONSTRAINTS`、`normalizeScriptConstraints`、`constraintsForFormat`、公共 `/api/presets?module=script` 的 catalog 元数据。
- `ScriptPage` form values include `extractionPreset` with default `standard`.
- State includes `constraints` and `constraintCatalog`.
- Calls `extractCharactersAndScenes(values.novelText, values.extractionPreset)`.
- Calls `generateScript({ ..., constraints: constraintsForFormat(constraints, values.format) })`.

- [ ] **Step 1: 写页面静态契约失败测试**

创建 `tests/script-page-contract.test.js`，以代码文本契约防止关键 UI 和请求参数被回归删除：

```js
test('script page exposes instruction selection, segmented opening and shotlist', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /切换指令/);
  assert.match(page, /剧本标准提取/);
  assert.match(page, /小说面板提取/);
  assert.match(page, /value: 'segmented'/);
  assert.match(page, /label: '分段开头'/);
  assert.match(page, /value: 'shotlist'/);
  assert.match(page, /label: '分镜模式'/);
});

test('script page controls constraints by output format and sends them with generation', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /约束设置/);
  assert.match(page, /format === 'shortdrama'/);
  assert.match(page, /constraintsForFormat/);
  assert.match(page, /constraints:/);
  assert.match(page, /extractionPreset/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/script-page-contract.test.js
```

Expected: FAIL，当前页面没有新模式、提取方案或约束状态。

- [ ] **Step 3: 添加状态、草稿和预设目录加载**

在 `ScriptPage.jsx`：

1. 引入 `Switch`、`Divider`、`Tooltip`（仅使用当前已安装的 Ant Design）和齿轮图标 `Settings2`；
2. 引入 `DEFAULT_SCRIPT_CONSTRAINTS`、`normalizeScriptConstraints`、`constraintsForFormat`；
3. 新增：

```js
const [instructionModalOpen, setInstructionModalOpen] = useState(false);
const [constraintModalOpen, setConstraintModalOpen] = useState(false);
const [constraints, setConstraints] = useState(DEFAULT_SCRIPT_CONSTRAINTS);
const [constraintCatalog, setConstraintCatalog] = useState([]);
```

4. 组件加载时调用现有 `apiRequest('/api/presets?module=script')` 或在 `generation.js` 添加 `listScriptPresetCatalog()`，保存 `result.catalog || []`；失败时只显示“系统约束预设加载失败”，但用户仍可输入自定义内容；
5. 更新 `snapshotDraft`、恢复草稿和所有 `persistDraft` 调用，使 `extractionPreset` 与 `constraints` 被保存/恢复；
6. 新项目/无历史草稿时：`extractionPreset: 'standard'` 且 `constraints: DEFAULT_SCRIPT_CONSTRAINTS`；
7. 更新 `handleExtract` 和 `regenerateEntities`，将当前 `form.getFieldValue('extractionPreset')` 传入 API；
8. `generateOutput` 使用 `constraintsForFormat(constraints, values.format)` 发送约束；更新 formatName 映射新增 `shotlist`。

- [ ] **Step 4: 实现“切换指令”弹窗**

把第 482 行无效加号按钮替换成：

```jsx
<button
  type="button"
  aria-label="切换人物场景提取指令"
  title="切换指令"
  onClick={() => setInstructionModalOpen(true)}
>
  <Plus size={17} strokeWidth={1.8} aria-hidden="true" />
</button>
```

添加 `Modal`，包含两个单选卡/`Segmented` 选项：

```js
const extractionOptions = [
  { label: '剧本标准提取', value: 'standard', description: '沿用当前剧本人物与场景提取规则。' },
  { label: '小说面板提取', value: 'novelPanel', description: '使用 V77 小说面板的统一风格、人物关系、阶段与场景分析规则。' }
];
```

保存按钮执行：

```js
form.setFieldValue('extractionPreset', pendingExtractionPreset);
persistDraft({ ...form.getFieldsValue(), extractionPreset: pendingExtractionPreset });
setInstructionModalOpen(false);
```

在原文输入区下方或提取状态行显示当前方案名称，例如：`当前提取指令：小说面板提取`。

- [ ] **Step 5: 添加第三策略、第四格式和剧本模式约束禁用**

更新选项：

```jsx
<Segmented options={[
  { label: '连续开头', value: 'continuous' },
  { label: '爆款开头', value: 'hook' },
  { label: '分段开头', value: 'segmented' }
]} />
```

```jsx
<Select options={[
  { label: '画布模式', value: 'storyboard' },
  { label: '剧本模式', value: 'shortdrama' },
  { label: '剧情模式', value: 'screenplay' },
  { label: '分镜模式', value: 'shotlist' }
]} />
```

为 format 加 watcher：

```js
const selectedFormat = Form.useWatch('format', form);
const constraintsAllowed = selectedFormat !== 'shortdrama';
```

当 format 改为 `shortdrama` 时关闭约束 modal；不要删除已保存的设置，以便切回允许模式时恢复，但生成请求通过 `constraintsForFormat` 强制发送关闭状态。

- [ ] **Step 6: 实现约束设置 Modal**

在输出模式 Select 旁加入 `约束设置` 按钮。选择 `shortdrama` 时按钮 `disabled`，以 `Tooltip` 显示“剧本模式是拍摄执行文本，不支持视频提示词约束设置”。

Modal 内：

1. 总开关 `Switch`，标题“启用本次及后续剧本输出约束”；
2. 四个独立区块：画面前缀词、画质约束、画面限制、负面提示词；
3. 每个区块包含：
   - “不选择”选项；
   - 从 `constraintCatalog` 按 `constraintCategory` 或 ID 前缀过滤的系统预设 `Select`；
   - “使用自定义内容”多行 `Input.TextArea`；
   - 预设选择和自定义文本可同时保留，但自定义内容优先；
   - 说明文字：“编辑系统预设不会覆盖系统内容；当前填写内容仅保存到当前账号剧本草稿。”
4. 点击“保存并启用”将临时 state 规范化后写入 `constraints`，调用 `persistDraft()`；
5. 点击“取消”丢弃 modal 内未保存的临时副本；
6. 总开关关闭时不清理四类保存内容，只是不注入；
7. 四项全空时允许保存开启，但生成时不得输出空标签。

禁止向用户端传输任何系统预设 `body`。下拉选项仅显示名称与说明。

- [ ] **Step 7: 加入局部样式并适配窄屏**

在 `global.css` 使用现有 `.script-tabs`、`.script-toolbar`、`.script-chat-tools` 风格新增：

```css
.script-instruction-status { /* 当前提取方案标签 */ }
.script-constraint-button { /* 工具栏辅助按钮 */ }
.script-constraint-section { /* Modal 内单类区域 */ }
.script-constraint-section + .script-constraint-section { /* 边界和间距 */ }
.script-constraint-help { /* 辅助说明 */ }
```

要求：
- 不修改全局 Ant Design token；
- 在现有工具栏横向滚动布局中，约束按钮不挤压“生成剧本”；
- 小于现有移动端断点时约束区块单列、选择框占满宽度；
- 深浅主题均使用现有 CSS 变量。

- [ ] **Step 8: 运行页面契约和草稿测试**

Run:

```powershell
node --test tests/script-page-contract.test.js tests/script-draft-persistence-contract.test.js tests/script-constraints-contract.test.js
```

Expected: PASS。

---

### Task 6: 端到端契约、构建和人工验收

**Files:**
- Modify: `tests/system-preset-catalog.test.js`
- Modify: `tests/script-generation-message-contract.test.js`
- Modify: `tests/script-page-contract.test.js`
- Modify: `tests/constraint-preset-admin-contract.test.js`
- Modify only if source snapshot changes are intentional: `data/system/presets.json`, `data/system/preset-audit.json`

**Interfaces:**
- Validates final generated request composition, not only UI option presence.
- Validates fresh startup seeds missing prebuilt presets through `seedSystemPresets`; persistent system JSON changes are only needed if repository policy requires immediate checked-in seed snapshots.

- [ ] **Step 1: 添加 V77 分段请求快照测试**

在 `tests/script-generation-message-contract.test.js` 增加一个包含换场景、聊天信息载体和人物关系变化的文本，断言最终 system prompt 同时存在：

```js
assert.match(system, /不按自然段、字数、句号或标点机械切分/);
assert.match(system, /建立、推进和卡点/);
assert.match(system, /当前原文事实为最高优先级/);
assert.match(system, /空镜或物件镜/);
assert.match(system, /每句对白只出现一次/);
assert.match(system, /00:10/);
```

断言 user message 保持小说、人物和场景分区，且不泄露约束预设正文之外的管理字段。

- [ ] **Step 2: 添加格式不回归矩阵测试**

用 `for (const format of ['storyboard', 'screenplay', 'shortdrama', 'shotlist'])` 和 `for (const mode of ['continuous', 'hook', 'segmented'])` 构建 messages：

- 每个合法组合不得抛错；
- 每个格式包含对应格式预设的唯一标识标题；
- 每个策略包含对应策略的唯一标识标题；
- `shortdrama` 无论 constraints 是否启用，都不包含 `【画面前缀】`、`【画质约束】`、`【负面提示词】`；
- 其他三种格式在 constraints 有值时均包含三类正确标题；
- constraints 空值时不包含任何上述标题。

- [ ] **Step 3: 运行完整 Node 测试集**

先查看 `package.json` 里的实际测试脚本，然后运行项目规定命令。例如：

```powershell
npm test
```

若没有统一脚本，运行：

```powershell
node --test tests/*.test.js
```

Expected: 全部通过。任何既有失败必须先确认是否为本变更造成；若是，修复后再继续。

- [ ] **Step 4: 运行前端静态检查和构建**

先读取 `frontend/package.json`，运行其中存在的 lint、test、build 脚本。典型顺序：

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```

只运行实际定义的脚本；如果某个脚本不存在，记录其不存在而不虚构命令。

Expected: lint 与 build 成功。

- [ ] **Step 5: 在已运行的本地服务中执行人工冒烟检查**

使用浏览器完成以下检查，不创建新项目或不触碰无关页面：

1. 打开 `/script`，确认默认提取方案为“剧本标准提取”、默认策略为连续开头、默认格式为画布模式、约束设置默认关闭；
2. 点击“切换指令”，选择“小说面板提取”，刷新页面后确认该选择随草稿恢复；
3. 用一段含人物、换地点和聊天记录的短小说提取，确认人物和场景可被正常显示及编辑；
4. 选择“分段开头 + 分镜模式 + 10s”，生成后确认输出为多个独立单元，包含 `统一风格`、`统一人物`、`镜头画面`，且每单元末镜到 `00:10`；
5. 切换 15s，重新生成，确认每单元末镜到 `00:15`；
6. 打开约束设置，仅选择“3D 国漫”画面前缀和通用负面词，保存启用，确认画布/剧情/分镜模式输出按“前缀 → 原格式主体 → 负面词”顺序出现，未选择类别没有空标题；
7. 切换剧本模式，确认约束按钮不可用；即使此前已保存约束，生成输出也不含约束标题；
8. 回到分镜模式，确认此前已保存约束恢复且可继续使用；
9. 检查一次历史导出头部，确认分段开头显示“模式：分段开头”，分镜模式显示“格式：分镜模式”。

- [ ] **Step 6: 检查预设持久化策略**

不要手工直接编辑 `data/system/presets.json` 或 `preset-audit.json`，除非项目启动的 `seedSystemPresets` 不会在目标部署环境自动执行。优先通过启动后种子逻辑或管理员后台创建/发布产生审计记录。

若仓库测试/部署需要 checked-in 初始快照：

1. 使用项目现有 preset store API 生成种子数据，而非手写审计记录；
2. 确认 `presets.json` 中每个新增预设为 `published`；
3. 确认 `preset-audit.json` 有配对的 `preset.draft_created` 与 `preset.published` 事件；
4. 再运行完整测试集。

- [ ] **Step 7: 最终验证记录**

在交付说明中列出实际运行的测试、lint、build 命令及其结果；明确说明：

- 分段开头策略实际通过 `mode: segmented → script-segmented` 映射执行；
- 分镜模式实际通过 `format: shotlist → script-format-shotlist` 映射执行；
- 剧本模式由服务端强制排除约束；
- 系统约束正文未通过公开 catalog 暴露给普通用户。
