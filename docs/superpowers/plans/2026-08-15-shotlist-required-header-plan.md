# 分镜模式强制基础设定结构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分镜模式在任一开头策略下均按服务端生成的人物、场景基础设定结构输出，并在模型遗漏时对每个分镜补齐头部。

**Architecture:** 在 `routes/chat.js` 增加纯函数：从已提取实体构建可信的固定头部，并在模型返回后只针对 `shotlist` 结果进行分镜区块补齐。`buildScriptMessages()` 将固定头部写入 system prompt，非流式 `/api/chat` 在转发前解析 OpenAI 兼容响应、修改 `choices[0].message.content` 后保持原响应结构返回。分镜模式提示词同步写明头部协议。

**Tech Stack:** Node.js CommonJS、Express、Node.js `node:test`、OpenAI 兼容聊天响应、Markdown 分镜文本。

## Global Constraints

- 仅 `format === 'shotlist'` 启用；连续、爆款、分段策略必须获得同一规则。
- 画布、剧情、剧本模式的请求与返回内容不得经过此补齐。
- 每个分镜必须恰好一行 `【基础设定】生成视频不带字幕 | 9:16`，最多三个人物行和可用的场景环境行。
- 人物模块按 基本体征 → 五官与妆容 → 发型与发饰 → 服饰与配饰；缺失字段跳过，绝不编造。
- 每个分镜固定头部来自服务端实体，用户约束和模型输出不得覆盖它。
- 补齐只改每个 `### 分镜` 标题后到 `镜头画面：` 前的头部，不重写镜头、对白、时间码、剧情或用户约束。
- 未发现 `### 分镜` 标题时保留模型原文；不自动重试、不伪造分镜。
- 流式 API 保持原样；当前剧本生成使用 `stream: false`。
- 所有行为先以失败测试定义，再写生产实现；每个任务独立提交。

---

## 文件结构

- `routes/chat.js`：实体映射、分镜头部构建、提示词注入、非流式响应补齐。
- `tests/shotlist-required-header.test.js`：纯函数、三种策略、补齐与非分镜保护测试。
- `tests/chat-route-output.test.js`：路由层验证模型响应内的分镜文本被补齐且响应格式保持兼容。
- `prompts/分镜模式.md`：明确固定头部协议和禁止 JSON 占位符。
- `tests/script-shot-prompt-contract.test.js`：分镜模式提示词文件的静态契约。

## Task 1: 定义固定头部与纯补齐函数

**Files:**
- Modify: `routes/chat.js:49-230`
- Create: `tests/shotlist-required-header.test.js`

**Interfaces:**
- Produces: `buildRequiredShotHeader(characters, scenes)` 与 `enforceShotlistHeaders(output, requiredShotHeader)`，并通过 `chat._private` 导出供测试调用。
- `buildRequiredShotHeader()` 返回以 `【基础设定】生成视频不带字幕 | 9:16` 开头的多行字符串。
- `enforceShotlistHeaders()` 返回字符串；没有 `### 分镜` 标题时返回原字符串。

- [ ] **Step 1: 写失败测试**

创建 `tests/shotlist-required-header.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const chat = require('../routes/chat');
const { buildRequiredShotHeader, enforceShotlistHeaders } = chat._private;

const characters = [
  { 角色名称: '顾宁', 基本体征: '年轻女性', 五官与妆容: '五官清秀、淡妆', 发型与发饰: '黑色长发', 服饰与配饰: '深色外套与通勤包' },
  { 角色名称: '赵婷', 发型: '短发', 服装: '浅色衬衫与工牌' },
  { 角色名称: '陈建国', 外貌描述: '中年男性，灰色夹克' },
  { 角色名称: '第四人', 外貌描述: '不得出现' }
];
const scenes = [{ 场景名称: '海关安检通道', 时间: '白天', 情绪基调: '紧张压迫' }];

test('builds a three-character shot header from extracted fields without invention', () => {
  assert.equal(buildRequiredShotHeader(characters, scenes), [
    '【基础设定】生成视频不带字幕 | 9:16',
    '顾宁：年轻女性，五官清秀、淡妆，黑色长发，深色外套与通勤包',
    '赵婷：短发，浅色衬衫与工牌',
    '陈建国：中年男性，灰色夹克',
    '场景环境：海关安检通道｜白天｜紧张压迫'
  ].join('\n'));
});

test('deduplicates names and omits empty entity fields and placeholders', () => {
  const header = buildRequiredShotHeader([
    { 姓名: '阿青', 发型: '短发' }, { name: '阿青', 服装: '红衣' }, {}, '无名描述'
  ], [{ 场景描述: '雨夜巷口' }]);
  assert.match(header, /^【基础设定】生成视频不带字幕 \| 9:16/m);
  assert.match(header, /阿青：短发/);
  assert.doesNotMatch(header, /红衣|无名描述|\{.*\}|未知|：\s*$/m);
  assert.match(header, /场景环境：雨夜巷口/);
});

test('inserts a complete header once into every missing or malformed shotlist unit', () => {
  const header = buildRequiredShotHeader(characters, scenes);
  const output = [
    '### 分镜一（总时长：10s）', '统一人物：模型乱写', '镜头画面：', '00:00-00:10 | 画面一', '---',
    '### 分镜二（总时长：10s）', '镜头画面：', '00:00-00:10 | 画面二'
  ].join('\n');
  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/【基础设定】生成视频不带字幕 \| 9:16/g) || []).length, 2);
  assert.equal((result.match(/顾宁：年轻女性/g) || []).length, 2);
  assert.doesNotMatch(result, /统一人物：模型乱写/);
});

test('does not duplicate a correct header and preserves text without shot titles', () => {
  const header = buildRequiredShotHeader(characters, scenes);
  const correct = `### 分镜一（总时长：10s）\n${header}\n\n镜头画面：\n00:00-00:10 | 画面`;
  assert.equal(enforceShotlistHeaders(correct, header), correct);
  assert.equal(enforceShotlistHeaders('没有格式标题的原文', header), '没有格式标题的原文');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/shotlist-required-header.test.js`  
Expected: FAIL，`buildRequiredShotHeader` 和 `enforceShotlistHeaders` 尚未导出。

- [ ] **Step 3: 实现最小纯函数**

在 `routes/chat.js` 的 `normalizeDuration` 后添加以下责任单一的辅助函数：

```js
const REQUIRED_SHOT_BASE = '【基础设定】生成视频不带字幕 | 9:16';
const characterNameFields = ['角色名称', '姓名', '名称', 'name', '人物'];
const characterGroups = [
  ['基本体征', '体征', '身形', '年龄', '身份'],
  ['五官与妆容', '五官', '妆容', '面容'],
  ['发型与发饰', '发型', '发饰'],
  ['服饰与配饰', '服饰', '服装', '配饰', '穿着']
];
```

- 将字符串实体视为无姓名项，不输出人物行。
- 仅保留前三个不重复且有姓名的人物；每个组从候选字段中取第一个非空短文本；若四组都空，才取 `外貌描述`、`外形`、`外观描述`、`描述` 的首个非空文本。
- 场景寻找第一个有数据对象，按地点、时间、情绪三个字段组拼接；仅当三个主要字段都空时取 `场景描述` 或 `描述`。
- `enforceShotlistHeaders` 用标题正则 `/^###\s*分镜[^\n]*$/gm` 切分；对每个区块寻找首个 `镜头画面：`。标题至该标签间若与完整 header 不完全一致，删除该区间内以 `【基础设定】`、`统一人物：`、`场景环境：` 开头的行与空行，然后在标题后插入 `header + '\n\n'`。保留区间中其他约束行，保证用户约束不丢失。
- 将两函数加入 `module.exports._private`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/shotlist-required-header.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add routes/chat.js tests/shotlist-required-header.test.js
git commit -m "feat: build required shotlist headers"
```

## Task 2: 将固定头部加入所有分镜策略提示词

**Files:**
- Modify: `routes/chat.js:189-229`
- Modify: `prompts/分镜模式.md:3-28`
- Modify: `tests/shotlist-required-header.test.js`
- Modify: `tests/script-shot-prompt-contract.test.js`

**Interfaces:**
- Consumes: Task 1 的 `buildRequiredShotHeader()`。
- Produces: 所有 `mode` 加 `format: 'shotlist'` 的 system prompt 包含同一服务器固定头部与逐字复用规则。

- [ ] **Step 1: 扩展失败测试**

在 `tests/shotlist-required-header.test.js` 添加：

```js
test('requires the same server header for continuous hook and segmented shotlists', () => {
  for (const mode of ['continuous', 'hook', 'segmented']) {
    const messages = chat._private.buildScriptMessages({
      mode, format: 'shotlist', duration: '10s', novelText: '测试', characters, scenes, protagonists: [], constraints: {}
    }, { getPublished() { return null; } });
    assert.match(messages[0].content, /强制基础设定结构/);
    assert.match(messages[0].content, /【基础设定】生成视频不带字幕 \| 9:16/);
    assert.match(messages[0].content, /必须逐字使用服务器提供的固定头部/);
  }
});

test('does not add a required header prompt to non-shotlist formats', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试', characters, scenes, protagonists: [], constraints: {}
  }, { getPublished() { return null; } });
  assert.doesNotMatch(messages[0].content, /强制基础设定结构/);
});
```

在 `tests/script-shot-prompt-contract.test.js` 添加：

```js
test('shotlist prompt requires the server-provided base header inside every unit', () => {
  const content = fs.readFileSync(path.join(prompts, '分镜模式.md'), 'utf8');
  assert.match(content, /【基础设定】生成视频不带字幕 \| 9:16/);
  assert.match(content, /服务器提供/);
  assert.match(content, /不得输出.*JSON|JSON.*不得输出/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/shotlist-required-header.test.js tests/script-shot-prompt-contract.test.js`  
Expected: FAIL，提示词与 `buildScriptMessages` 还没有强制头部协议。

- [ ] **Step 3: 修改提示词与请求组装**

在 `buildScriptMessages()` 中，在 `unitProtocol` 后计算：

```js
const requiredShotHeader = format === 'shotlist'
  ? buildRequiredShotHeader(body.characters, body.scenes)
  : '';
const requiredShotHeaderProtocol = requiredShotHeader
  ? `## 强制基础设定结构\n以下内容由服务器根据已提取人物和场景生成。每个 ### 分镜 标题后、镜头画面：前必须逐字使用服务器提供的固定头部；不得省略、改名、重排、写成 JSON、花括号占位符或共享前言。\n\n${requiredShotHeader}`
  : '';
```

将 `requiredShotHeaderProtocol` 放入 `systemPrompt` 数组，位于 `unitProtocol` 之后、`constraintWrapper` 之前。

更新 `prompts/分镜模式.md` 的模板：

```text
### 分镜一（总时长：{duration}）
【基础设定】生成视频不带字幕 | 9:16
{服务器提供的人物行，最多三行；逐字保留}
{服务器提供的场景环境行；存在时逐字保留}

镜头画面：
```

追加规则：基础设定与人物、场景行由服务器提供；每个分镜必须逐字保留；不得输出 JSON、花括号占位符或模型自行新增的固定人物行；连续、爆款、分段只影响镜头叙事，不改变固定头部。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/shotlist-required-header.test.js tests/script-shot-prompt-contract.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add routes/chat.js prompts/分镜模式.md tests/shotlist-required-header.test.js tests/script-shot-prompt-contract.test.js
git commit -m "feat: require headers in shotlist prompts"
```

## Task 3: 在非流式模型结果中强制补齐头部

**Files:**
- Modify: `routes/chat.js:340-359`
- Modify: `tests/shotlist-required-header.test.js`
- Create: `tests/chat-route-output.test.js`

**Interfaces:**
- Consumes: Task 1 的 `buildRequiredShotHeader()` 与 `enforceShotlistHeaders()`。
- Produces: `promptType: 'script'` 且 `format: 'shotlist'` 的非流式 OpenAI 兼容结果，在 `choices[0].message.content` 中拥有每分镜固定头部。

- [ ] **Step 1: 写失败路由测试**

在 `tests/chat-route-output.test.js` 复用项目现有 Express 测试中的应用工厂和上游请求 mock；用一个 `format: 'shotlist'` 请求及上游响应：

```js
const upstreamBody = JSON.stringify({
  choices: [{ message: { content: '### 分镜一（总时长：10s）\n镜头画面：\n00:00-00:10 | 画面' } }]
});
```

断言 API 响应保持 JSON，并且：

```js
assert.match(response.body.choices[0].message.content, /【基础设定】生成视频不带字幕 \| 9:16/);
assert.match(response.body.choices[0].message.content, /顾宁：年轻女性/);
assert.match(response.body.choices[0].message.content, /场景环境：海关安检通道｜白天｜紧张压迫/);
```

同时写画布模式用例，断言其原始 `choices[0].message.content` 严格不变。

在 `tests/shotlist-required-header.test.js` 添加多分镜、缺少一行、顺序错误、约束行保留的纯函数用例。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/chat-route-output.test.js tests/shotlist-required-header.test.js`  
Expected: FAIL，路由仍原样返回上游文本。

- [ ] **Step 3: 最小修改非流式响应路径**

在 `routes/chat.js` 的非流式 `JSON.parse(upstream.text)` 后、`res.end()` 前：

```js
const upstreamData = JSON.parse(upstream.text);
if (body.promptType === 'script' && normalizeFormat(body.format) === 'shotlist') {
  const content = upstreamData?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    upstreamData.choices[0].message.content = enforceShotlistHeaders(
      content,
      buildRequiredShotHeader(body.characters, body.scenes)
    );
  }
}
```

- 保持 `entity_enrich` 的既有早返回在此逻辑前。
- 强制补齐后使用 `JSON.stringify(upstreamData)` 写响应；非分镜仍可用原始 `upstream.text` 返回。
- 不修改 `payload.stream === true` 分支。
- 若 OpenAI 兼容响应缺少 `choices[0].message.content`，原样返回，不抛错。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/chat-route-output.test.js tests/shotlist-required-header.test.js tests/script-constraints.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add routes/chat.js tests/chat-route-output.test.js tests/shotlist-required-header.test.js
git commit -m "feat: enforce shotlist headers in responses"
```

## Task 4: 回归验证

**Files:**
- Modify: 无，除非验证发现本功能范围内问题。

- [ ] **Step 1: 运行聚焦服务端测试**

Run:

```bash
node --test tests/shotlist-required-header.test.js tests/chat-route-output.test.js tests/script-shot-prompt-contract.test.js tests/script-constraints.test.js tests/agent-routes.test.js
```

Expected: PASS。

- [ ] **Step 2: 运行前端构建**

Run: `npm run frontend:build`  
Expected: exit code `0`；允许现有 Vite 大分包警告，不允许编译错误。

- [ ] **Step 3: 手动验收**

1. 在剧本页提取至少三个人物和一个包含地点、时间、情绪的场景。
2. 依次选择连续开头、爆款开头、分段开头和分镜模式，分别生成。
3. 每个 `### 分镜` 都有恰好一次基础设定、至多三个人物行、场景环境和镜头画面。
4. 关闭约束设置后仍有强制基础设定；开启任意约束后，该约束保留在每个分镜内部且不覆盖基础设定。
5. 切换到画布、剧情和剧本模式，确认结果未被插入基础设定头部。
6. 用外貌字段缺失的人物生成，确认只显示已有字段且没有 JSON 花括号、`未知` 或空人物行。

- [ ] **Step 4: 提交验证中发现的范围内修复**

只有在手动或自动验证修复了本计划范围内文件时，按实际文件暂存并提交；例如：

```bash
git add routes/chat.js tests/shotlist-required-header.test.js
git commit -m "fix: preserve shotlist header structure"
```
