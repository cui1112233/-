# 剧本统一完整分镜单元 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让非剧本模式按统一“分镜 N”完整时长单元输出，并将每个单元作为可独立复制的视频提示词卡片。

**Architecture:** 修改服务端约束注入与输出格式预设，要求每个 `### 分镜 N` 自带当前适用的基础设定、人物、场景和已启用约束。前端解析器只接受顶层“分镜 N”或 JSON 单元；卡片直接显示并复制模型返回的单元原文，不再拼接前言。

**Tech Stack:** Node.js、Express、React、Ant Design、Node.js 内置测试、Vite。

## Global Constraints

- 不新增第三方依赖。
- `shortdrama` 剧本模式保持完整文本输出框。
- 非剧本模式顶层单元只使用 `### 分镜 N`，禁止顶层“镜头 N”。
- 每个分镜从 `00:00` 到当前选择结束时间：10 秒为 `00:10`，15 秒为 `00:15`。
- 每个分镜只包含当前提示词实际要求和用户实际启用的规则；不得虚构声音、风格、画质或空标题。
- 卡片复制模型返回的完整分镜原文，不在前端拼接任何前言。
- 原始输出仍是草稿和历史唯一保存值。
- 不添加代码注释。
- 不提交 Git 提交；仅由用户明确要求时提交。

---

## 文件结构

- 修改 `prompts/画布模式.md`：每个完整单元使用“分镜 N”，每个单元内包含画布模式所需内容。
- 修改 `prompts/分镜模式.md`：增加统一分镜标题、时长和独立提示词要求。
- 修改 `prompts/剧情模式.md`：增加统一分镜标题和独立单元要求。
- 修改 `prompts/约束设置.md`：启用约束时将适用约束写入每个分镜内部。
- 修改 `routes/chat.js`：将约束正文作为每个单元必须包含的生成规则，而不是整个输出的包裹前后文本。
- 修改 `frontend/src/user/pages/scriptShotOutput.js`：仅按顶层分镜标题或 JSON 数组拆分，不识别“镜头 N”。
- 修改 `frontend/src/user/components/ShotOutputCards.jsx`：显示当前选择时长。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：传入时长；卡片与所有复制操作只使用单元原文。
- 修改 `tests/system-preset-catalog.test.js`：验证约束提示词协议注入。
- 修改 `tests/script-shot-output.test.js`：验证完整分镜单元边界。
- 修改 `tests/script-shot-output-ui-contract.test.js`：验证卡片复制不拼接前言、显示时长。
- 创建 `tests/script-shot-prompt-contract.test.js`：验证三个非剧本格式提示词的统一分镜协议。

### Task 1: 统一非剧本分镜输出与约束协议

**Files:**
- Modify: `prompts/画布模式.md`
- Modify: `prompts/分镜模式.md`
- Modify: `prompts/剧情模式.md`
- Modify: `prompts/约束设置.md`
- Modify: `routes/chat.js`
- Modify: `tests/system-preset-catalog.test.js`
- Create: `tests/script-shot-prompt-contract.test.js`

**Interfaces:**
- `buildConstraintWrapper(presetStore, constraints, format)` 产生“每个分镜内部”的约束指令，而不是 `before`、`after` 输出包裹文本。
- `buildScriptMessages(body, presetStore)` 将格式、模式与约束协议提供给模型。

- [ ] **Step 1: 写入提示词协议失败测试**

```js
test('non-shortdrama prompt contracts require self-contained 分镜 units', () => {
  for (const file of ['画布模式.md', '剧情模式.md', '分镜模式.md']) {
    const content = fs.readFileSync(path.join(prompts, file), 'utf8');
    assert.match(content, /### 分镜/);
    assert.match(content, /00:00/);
    assert.match(content, /独立/);
    assert.doesNotMatch(content, /镜头一.*完整四段结构/);
  }
  const constraint = fs.readFileSync(path.join(prompts, '约束设置.md'), 'utf8');
  assert.match(constraint, /每个分镜内部/);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-shot-prompt-contract.test.js`

预期：失败，因为现有预设仍使用镜头标题与全局约束包裹。

- [ ] **Step 3: 改写输出预设协议**

每个非剧本格式预设加入如下硬性规则：

```text
只输出一个或多个完整分镜单元。每个单元必须从“### 分镜一（总时长 {duration}）”开始；后续使用“### 分镜二”。禁止在分镜前输出共享前言，禁止使用顶层“镜头 N”。
每个分镜必须自带当前格式实际要求的全部内容；若当前格式要求基础设定、人物或场景，它们必须写在该分镜标题之后。每个分镜必须从 00:00 开始，并于 {结束时间} 结束。
```

画布模式把原“输出格式模板”的基础设定、声音设计、氛围规范与时间轴置入每个“分镜 N”模板中；不要求声音或风格的格式不得新增该字段。分镜模式用“### 分镜 N”包裹其原有统一风格、统一人物和镜头画面结构。剧情模式同样输出完整单元。

- [ ] **Step 4: 改写约束规则与服务端注入**

将 `约束设置.md` 改为：只有启用的类别才出现在每个分镜内；每个分镜把画面前缀、画质约束/限制放在该单元开头，负面提示词放在该单元末尾。

在 `chat.js` 将约束文本改为单个 instruction：

```js
return constraintText
  ? `## 分镜内约束\n${constraintText}\n\n每个完整分镜必须在自身标题之后写入以上所有非空约束；不得在全部分镜之外单独输出这些约束。`
  : '';
```

删除 `constraintWrapper.before` 与 `constraintWrapper.after` 对 `systemPrompt` 的位置包裹，保留 `constraintWrapper` 指令在格式预设之前。

- [ ] **Step 5: 运行服务端与提示词测试**

运行：`node --test tests/script-shot-prompt-contract.test.js tests/system-preset-catalog.test.js`

预期：通过。

### Task 2: 只按完整分镜单元解析和复制

**Files:**
- Modify: `frontend/src/user/pages/scriptShotOutput.js`
- Modify: `tests/script-shot-output.test.js`

**Interfaces:**
- `getShotCards(format, output) -> string[]` 仅返回 JSON 单元或以顶层 `### 分镜 N` 开始的完整单元。
- `joinShotCards(cards, selectedIndexes) -> string` 保持卡片原文顺序，仅用两个换行拼接。

- [ ] **Step 1: 写入失败解析测试**

```js
test('returns only complete 分镜 units and retains internal timestamps', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B\n\n---\n\n### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C';
  assert.deepEqual(getShotCards('storyboard', output), [
    '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B',
    '### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C'
  ]);
  assert.deepEqual(getShotCards('storyboard', '### 分镜一（总时长 10s）\n00:00-00:03 | A\n00:03-00:10 | B'), []);
  assert.deepEqual(getShotCards('storyboard', '镜头一\n00:00-00:10 | A\n\n镜头二\n00:00-00:10 | B'), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-shot-output.test.js`

预期：失败，因为当前解析器也接受“镜头 N”。

- [ ] **Step 3: 收紧顶层分镜标题解析**

将文本匹配规则限制为行首 Markdown 三级标题或更高层级的 `分镜`：

```js
const UNIT_HEADING = /^#{3,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+).*$/gim;
```

解析时删除单元末尾独立分隔线：

```js
return matches.map((match, index) => output.slice(match.index, matches[index + 1]?.index).replace(/\n?---\s*$/m, '').trim());
```

保留 JSON 数组解析。不得按 `镜头`、`场景`、时间码或普通段落切分。

- [ ] **Step 4: 运行解析测试确认通过**

运行：`node --test tests/script-shot-output.test.js`

预期：通过。

### Task 3: 卡片时长标识与原文复制集成

**Files:**
- Modify: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- `ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected })`。
- `onCopy(card)`、`onCopySelected()` 只接收完整分镜原文。

- [ ] **Step 1: 写入失败页面契约测试**

```js
test('shot cards show the selected duration and copy complete unit source directly', () => {
  assert.match(cards, /分镜 \{index \+ 1\} · \{duration\}/);
  assert.match(page, /duration=\{form\.getFieldValue\('duration'\)\}/);
  assert.match(page, /onCopy=\{copyText\}/);
  assert.match(page, /joinShotCards\(shotCards, selectedShotIndexes\)/);
  assert.doesNotMatch(page, /shared.*prefix/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-shot-output-ui-contract.test.js`

预期：失败，因为卡片没有时长属性。

- [ ] **Step 3: 传入时长并保持原文复制**

更新组件：

```jsx
<Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>
  分镜 {index + 1} · {duration}
</Checkbox>
```

`ScriptPage` 渲染卡片时传入 `duration={form.getFieldValue('duration')}`。顶层复制继续使用 `shotCards.join('\n\n')`，卡片复制继续 `onCopy={copyText}`，批量复制继续 `joinShotCards(shotCards, selectedShotIndexes)`；不得在这些路径添加或组合前言。

- [ ] **Step 4: 运行页面契约测试**

运行：`node --test tests/script-shot-output-ui-contract.test.js`

预期：通过。

### Task 4: 全量验证

**Files:**
- Modify: 仅为修复验证发现的问题修改以上文件。

- [ ] **Step 1: 运行定向测试**

运行：

```powershell
node --test tests/script-shot-prompt-contract.test.js tests/script-shot-output.test.js tests/script-shot-output-ui-contract.test.js tests/system-preset-catalog.test.js tests/script-draft-persistence-contract.test.js
```

预期：全部通过。

- [ ] **Step 2: 前端生产构建**

运行：`npm --prefix frontend run build`

预期：Vite 构建成功。

- [ ] **Step 3: 检查诊断**

检查 `scriptShotOutput.js`、`ShotOutputCards.jsx`、`ScriptPage.jsx`、`chat.js`，预期无诊断错误。

- [ ] **Step 4: 浏览器验收**

在 10 秒画布模式生成至少两条分镜：确认每卡标题为“分镜 N · 10s”，每张正文自带该格式实际要求的基础设定、人物、场景与已启用约束，内部时间轴结束于 `00:10`。切换到 15 秒确认卡片为“分镜 N · 15s”且时间轴结束于 `00:15`。复制单卡和多选卡确认复制内容等于对应卡片原文。剧本模式确认仍为完整文本框。

## 自检

- 规格覆盖：任务 1 在生成源头统一分镜与规则位置；任务 2 限定卡片分割边界；任务 3 确保卡片只显示和复制完整原文；任务 4 覆盖服务端、前端与浏览器验证。
- 占位符检查：计划不含 TBD、TODO 或未定义实现步骤。
- 接口一致性：任务 2 的 `getShotCards` 供任务 3 使用；任务 3 的卡片组件只接收模型原文；任务 1 规定模型原文必须在每个分镜内完整。
