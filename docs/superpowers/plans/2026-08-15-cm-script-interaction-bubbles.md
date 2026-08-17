# CM 剧本互动气泡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 为 CM 增加剧本阶段感知的头顶主动气泡和对话框快捷分析气泡，使用户能一键发起受控的剧本分析或修改稿请求。

**Architecture:** 在 `stacky.js` 中实现纯规则：将已规范化的宠物状态与剧本页面上下文映射为头顶文案和快捷操作。`StackyPet` 使用这些规则渲染可点击头顶气泡与输入框上方的操作按钮，点击后复用现有 `sendQuestion()` / Agent 会话；`ScriptPage` 继续仅发送既有受限上下文和任务状态。

**Tech Stack:** React、现有 Agent API、现有 `CustomEvent` 宠物上下文桥接、Node 内置 `node:test`。

## Global Constraints

- 不新增 AI 接口、后端表、跨账号共享会话、自动覆盖剧本逻辑或第三方依赖。
- 头顶气泡仅点击打开 CM 对话，不得自动发送 Agent 请求。
- 快捷气泡必须经现有 `sendQuestion()`、`createAgentTask()`、`askAgent()` 和当前账号任务链路执行。
- 快捷气泡不得直接修改剧本；只有 Agent 回复包含 `【修改稿】` 且用户点击既有“应用到剧本”按钮时，才可触发 `dispatchPetApply()`。
- “强化冲突与反转”等建议型任务不应提示或自动应用改稿。
- CM 只能使用 `normalizePetContext()` 允许的受限上下文；不得读取 iframe 内容、密钥或额外原文数据。
- 生成完成气泡从设计指定的六句文案中随机选择；测试通过注入随机函数避免不稳定。
- 用户点击、关闭或取消气泡不写入剧本草稿；自由输入、会话恢复、账号切换、拖动、收起、关闭和 Agent 工作区跳转保持现有行为。
- 不覆盖用户已有修改；不创建 Git 提交，除非用户明确要求。

---

## 文件结构

- 修改 `frontend/src/shared/pet/stacky.js`：导出剧本互动文案和快捷操作的纯函数。
- 修改 `frontend/src/shared/pet/stacky.test.js`：测试完成态随机文案、各状态操作集合和预设提示词边界。
- 修改 `frontend/src/shared/pet/StackyPet.jsx`：将头顶气泡改为可点击按钮；在输入框前渲染快捷操作；点击操作复用 `sendQuestion()`。
- 修改 CM 样式所在文件：为主动气泡和快捷操作提供按钮样式、焦点状态、小屏换行及 asking 禁用效果。
- 修改 `tests/cm-agent-ui-contract.test.js`：验证现有 CM 对话框集成快捷气泡与改稿应用边界。
- 创建 `tests/cm-script-interaction-bubbles-contract.test.js`：验证剧本页面状态桥接和 CM 文案/快捷操作静态集成。

### Task 1: 构建阶段感知的互动气泡纯规则

**Files:**
- Modify: `frontend/src/shared/pet/stacky.js`
- Modify: `frontend/src/shared/pet/stacky.test.js`

**Interfaces:**
- Produces: `petPromptBubble(state, context, random = Math.random)` 与 `petQuickActions(state, context)`。
- Consumes: `normalizePetState()`、`normalizePetContext()` 返回的 `pagePath`、`summary`、`entities`、`actions`。

- [ ] **Step 1: 写入完成态文案与快捷操作失败测试**

```js
import { petPromptBubble, petQuickActions } from './stacky.js';

test('uses a generated-script prompt and analysis actions when script output is ready', () => {
  const context = { pagePath: '/script', summary: '剧本生成完成', entities: { scriptOutput: '片段' }, actions: [] };
  assert.equal(petPromptBubble('success', context, () => 0), '剧本生成好了。要 CM 帮您检查哪里还能更好吗~');
  assert.deepEqual(petQuickActions('success', context).map(action => action.id), [
    'overall-quality', 'weakest-section', 'opening-ten-seconds', 'character-consistency',
    'scene-visuals', 'conflict-reversal', 'rewrite-draft'
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test frontend/src/shared/pet/stacky.test.js`

Expected: FAIL，导出函数不存在。

- [ ] **Step 3: 实现纯规则与固定提示词**

定义完成态六句文案数组，顺序与设计说明一致。`petPromptBubble()` 必须：

1. 先规范化状态与上下文；
2. 只在 `pagePath === '/script'` 且可判断 `entities.scriptOutput` 非空、状态为 `success` 时，从六句中按 `Math.floor(clamp(random(), 0, 0.999999) * 6)` 选择；
3. 剧本页面未输入原文时返回“需要我帮您规划人物和冲突吗？”；
4. 已提取但尚未输出时返回“要我检查人物有没有遗漏或冲突吗？”；
5. `working` 返回“我在等结果，完成后可以帮您继续打磨。”；
6. `error` 返回“这次没有成功，要我帮您检查可能原因吗？”；
7. 非剧本页面继续调用/返回既有 `petSpeech(state)`，不改变其它页面默认反馈。

`petQuickActions()` 返回 `{ id, label, prompt, mode }` 数组。完成态 prompt 必须精确表达：

```js
{ id: 'overall-quality', label: '分析整体质量', prompt: '请分析当前剧本的整体质量，检查节奏、冲突、钩子和逻辑完整性，按优先级给出可执行建议。', mode: 'advice' }
{ id: 'weakest-section', label: '找出最弱的段落', prompt: '请找出当前剧本中最弱的段落，指出具体位置、问题原因和可执行的修改方向。', mode: 'advice' }
{ id: 'opening-ten-seconds', label: '优化开头 10 秒', prompt: '请判断当前剧本开头 10 秒是否足够抓人，在不改变核心事件的前提下给出优化建议。', mode: 'advice' }
{ id: 'character-consistency', label: '检查人物一致性', prompt: '请检查当前剧本中人物身份、性格、关系和称呼是否前后一致，列出证据和修正建议。', mode: 'advice' }
{ id: 'scene-visuals', label: '检查场景与画面感', prompt: '请检查当前剧本的场景是否清晰、镜头是否可拍、空间与道具是否连续，并给出建议。', mode: 'advice' }
{ id: 'conflict-reversal', label: '强化冲突与反转', prompt: '请只给出强化当前剧本冲突与反转的建议，不要直接改写剧本或输出修改稿。', mode: 'advice' }
{ id: 'rewrite-draft', label: '生成修改稿', prompt: '请先分析当前剧本，再输出一份完整可替换版本。修改稿必须用【修改稿】作为唯一标题，且不改变核心事件。', mode: 'rewrite' }
```

其它状态按设计返回：未输入原文 `plan-characters-conflict`、`how-to-start`；已提取 `check-character-omissions`、`check-scene-omissions`、`check-character-relations`；working 返回空数组；error 返回 `analyze-failure`、`check-settings`。每条对象都必须有明确中文 `label`、`prompt` 与 `mode: 'advice'`。

- [ ] **Step 4: 增加非完成状态与建议边界测试**

```js
test('offers only advice actions while working and keeps conflict action from requesting a rewrite', () => {
  assert.deepEqual(petQuickActions('working', { pagePath: '/script' }), []);
  const conflict = petQuickActions('success', { pagePath: '/script', entities: { scriptOutput: '片段' } }).find(item => item.id === 'conflict-reversal');
  assert.equal(conflict.mode, 'advice');
  assert.match(conflict.prompt, /不要直接改写剧本或输出修改稿/);
});
```

Run: `node --test frontend/src/shared/pet/stacky.test.js`

Expected: PASS。

### Task 2: 渲染可点击头顶气泡与对话快捷操作

**Files:**
- Modify: `frontend/src/shared/pet/StackyPet.jsx`
- Modify: CM 样式所在文件（用 `Grep` 定位 `.stacky-pet-bubble` 和 `.stacky-agent-input`）
- Modify: `tests/cm-agent-ui-contract.test.js`
- Create: `tests/cm-script-interaction-bubbles-contract.test.js`

**Interfaces:**
- Consumes: `petPromptBubble()`、`petQuickActions()` 和现有 `sendQuestion()`、`openChat()`、`contextRef.current`。
- Produces: 可打开对话的头顶按钮，及调用 `sendQuestion(action.prompt)` 的快捷按钮区。

- [ ] **Step 1: 写入 CM UI 合约失败测试**

在 `cm-agent-ui-contract.test.js` 加入断言：

```js
assert.match(pet, /petPromptBubble/);
assert.match(pet, /petQuickActions/);
assert.match(pet, /className="stacky-pet-bubble stacky-pet-bubble--interactive"/);
assert.match(pet, /onClick=\{openChat\}/);
assert.match(pet, /className="stacky-agent-quick-actions"/);
assert.match(pet, /sendQuestion\(action\.prompt\)/);
assert.match(pet, /action\.mode === 'rewrite'/);
```

创建 `cm-script-interaction-bubbles-contract.test.js`，读取 `StackyPet.jsx` 与 `ScriptPage.jsx`，断言完成工作流仍设置 `setGenerationStage('complete')`、`dispatchPetState('success')`，并断言宠物只经 `dispatchPetApply()` 应用带 `【修改稿】` 的回复。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test tests/cm-agent-ui-contract.test.js tests/cm-script-interaction-bubbles-contract.test.js
```

Expected: FAIL，互动函数与快捷操作渲染不存在。

- [ ] **Step 3: 接入 StackyPet**

在 `StackyPet` 中：

1. 导入两个规则函数；
2. 每次 render 由 `petPromptBubble(state, contextRef.current)` 得到 `bubbleText`，由 `petQuickActions(state, contextRef.current)` 得到 `quickActions`；
3. 将头顶 `<div className="stacky-pet-bubble">` 替换为：

```jsx
<button type="button" className="stacky-pet-bubble stacky-pet-bubble--interactive" onClick={openChat} title="打开 CM 对话">
  {reply || bubbleText}
</button>
```

`reply` 非空时仍显示任务反馈；点击保持只打开对话。

4. 在 `<form className="stacky-agent-input">` 之前渲染：

```jsx
{quickActions.length ? <div className="stacky-agent-quick-actions" aria-label="CM 建议操作">
  {quickActions.map(action => <button
    key={action.id}
    type="button"
    className={action.mode === 'rewrite' ? 'stacky-agent-quick-action stacky-agent-quick-action--rewrite' : 'stacky-agent-quick-action'}
    onClick={() => sendQuestion(action.prompt)}
    disabled={asking}
  >{action.label}</button>)}
</div> : null}
```

不得在点击头顶气泡时调用 `sendQuestion()`。快捷操作点击必须仅调用现有 `sendQuestion()`，不调用 `dispatchPetApply()`。

5. 保持既有回复应用条件；将条件收紧为仅在 `message.content.includes('【修改稿】')` 且当前快捷请求的 `mode === 'rewrite'` 或用户自由输入明确产生修改稿时显示应用按钮。若当前架构没有可可靠区分历史消息来源的 metadata，则本阶段保持现有 `【修改稿】` 文字条件，不为 advice 结果虚构 metadata；规则提示词保证 advice 动作不要求修改稿。

- [ ] **Step 4: 添加样式**

为 `.stacky-pet-bubble--interactive` 提供无默认边框、继承现有气泡字体和背景、`cursor: pointer`；增加 `:hover` / `:focus-visible` 清晰焦点。新增 `.stacky-agent-quick-actions`，使用 `display:flex; flex-wrap:wrap; gap:6px; padding`；快捷按钮支持小屏换行，不遮挡输入框。`--rewrite` 使用现有强调色但不能强制执行或模拟危险按钮。`asking` 时用原生 disabled 样式，不能隐藏按钮。

- [ ] **Step 5: 运行 CM 合约和现有宠物测试**

Run:

```powershell
node --test frontend/src/shared/pet/stacky.test.js tests/cm-agent-ui-contract.test.js tests/cm-script-interaction-bubbles-contract.test.js
```

Expected: PASS。

### Task 3: 回归验证与手工工作流检查

**Files:**
- Test: `frontend/src/shared/pet/stacky.test.js`
- Test: `tests/cm-agent-ui-contract.test.js`
- Test: `tests/cm-script-interaction-bubbles-contract.test.js`
- Test: `tests/script-entity-management.test.js`
- Test: `tests/script-entity-ui-contract.test.js`
- Test: `tests/script-entity-enrichment.test.js`
- Test: `tests/script-protagonist-generation-contract.test.js`

**Interfaces:**
- Consumes: 阶段气泡规则与 CM 交互界面。
- Produces: 已验证的剧本互动型 CM 气泡体验。

- [ ] **Step 1: 运行完整 CM 与剧本回归测试**

Run:

```powershell
node --test frontend/src/shared/pet/stacky.test.js tests/cm-agent-ui-contract.test.js tests/cm-script-interaction-bubbles-contract.test.js tests/script-entity-management.test.js tests/script-entity-ui-contract.test.js tests/script-entity-enrichment.test.js tests/script-protagonist-generation-contract.test.js
```

Expected: PASS。

- [ ] **Step 2: 前端生产构建**

Run: `npm run build`

Working directory: `frontend`

Expected: Vite build 成功；仅记录既有 bundle 大小警告。

- [ ] **Step 3: 手工验证完成态互动**

1. 登录后进入 `/script`，完成一轮小说提取和剧本生成；
2. 确认 CM 头顶显示六句完成态文案之一；点击它，只打开对话框，不立即创建或发送 Agent 请求；
3. 确认输入框上方显示七个完成态快捷气泡；
4. 点击“分析整体质量”，确认显示用户问题、进入工作状态、得到 Agent 建议，当前剧本没有变化；
5. 点击“强化冲突与反转”，确认请求明确要求只给建议，且不能自动应用；
6. 点击“生成修改稿”，确认只有 Agent 回复含 `【修改稿】` 时出现“应用到剧本”；点击前输出不变，点击后才替换；
7. 关闭、拖动、收起 CM，使用自由输入和跳转 Agent 工作区，确认既有行为未回归。

- [ ] **Step 4: 手工验证其它阶段与边界**

1. 清空原文，打开 CM，确认显示“规划人物与冲突”“如何开始”等快捷气泡；
2. 提取人物场景但不生成，确认显示遗漏/关系检查气泡；
3. 生成中，确认不显示会并发触发分析的快捷气泡；
4. 模拟错误后确认显示失败原因/检查设置气泡；
5. 关闭 CM 设置后确认不显示宠物和气泡；重新开启后功能恢复；
6. 确认点击任何气泡、打开或关闭对话均不写入剧本草稿。

- [ ] **Step 5: 变更范围检查**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` 无输出；变更仅涉及宠物规则、CM 组件/样式、测试及本设计/计划文档。不得创建 Git 提交，除非用户明确要求。
