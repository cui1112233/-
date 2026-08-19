# CM 灵动陪伴台词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CM 从固定待机提示改为可关闭、按时间和空闲状态自然冒泡的可爱陪伴宠物，同时保留优先级更高的任务反馈。

**Architecture:** 在 `frontend/src/shared/pet/companionSpeech.js` 建立无 React 依赖的台词调度和持久化函数，负责台词库、时段判定、随机间隔、去重与安全读写本地存储。`StackyPet` 保存当前气泡及其优先级，依据可见性、聊天、请求、拖拽和开关条件调用调度器；设置页以本地开关控制主动台词，不将此偏好提交到模型配置接口。

**Tech Stack:** React 18、JavaScript ES Modules、Ant Design、Node.js `node:test`、浏览器 `localStorage` 与 Page Visibility API。

## Global Constraints

- 只修改 CM 主动台词与气泡调度，不改动画精灵、聊天 API、剧本协作或 Agent 请求协议。
- 主动台词只在页面可见、聊天关闭、未请求 AI、未拖拽且开关开启时显示。
- 主动台词关闭后仍必须显示请求中、成功、失败和模型配置错误等任务反馈。
- 普通台词显示 6–8 秒；使用固定 `7000` 毫秒作为实现值。
- 空闲随机间隔必须是 45–90 分钟；使用 `[2700000, 5400000]` 毫秒闭区间。
- 相同用户的偏好与进度必须本地隔离；不持久化聊天、剧本、模型密钥或 Agent 上下文。
- 新增或修改的行为必须先以失败测试定义，再写实现；每个任务独立提交。

---

## 文件结构

- `frontend/src/shared/pet/companionSpeech.js`：台词常量、时间段、随机挑选、优先级、用户名隔离的本地存储与安全降级。
- `frontend/src/shared/pet/companionSpeech.test.js`：调度器所有纯函数与存储降级的单元测试。
- `frontend/src/shared/pet/stacky.js`：将固定任务状态文案替换为设计规定的可爱任务反馈。
- `frontend/src/shared/pet/stacky.test.js`：更新任务状态台词期望，避免回退到客服式文案。
- `frontend/src/shared/pet/StackyPet.jsx`：接入调度器、管理气泡优先级、可见性、计时器与点击互动。
- `frontend/src/user/pages/SettingsPage.jsx`：添加只保存在浏览器本地的“宠物主动说话”开关。
- `tests/cm-pet-companion-ui-contract.test.js`：覆盖设置开关和组件的静态交互契约。

## Task 1: 建立可测试的陪伴台词调度器

**Files:**
- Create: `frontend/src/shared/pet/companionSpeech.js`
- Create: `frontend/src/shared/pet/companionSpeech.test.js`

**Interfaces:**
- Produces: `COMPANION_SPEECH_PRIORITY`、`PET_COMPANION_SETTINGS_EVENT`、`companionSpeechStorageKey(username)`、`readCompanionSpeechState(username, storage)`、`writeCompanionSpeechState(username, state, storage)`、`getGreetingPeriod(date)`、`nextIdleSpeechAt(now, random)`、`pickSpeech(lines, previousIndex, random)`、`getClickSpeech(previousIndex, random)`、`getCompanionCandidate(options)`。
- `getCompanionCandidate({ now, username, storage, random, active, visible, chatOpen, asking, dragging })` 返回 `{ kind, text, priority, nextState } | null`；`kind` 为 `welcome`、`greeting` 或 `idle`。

- [ ] **Step 1: 编写失败测试**

在 `frontend/src/shared/pet/companionSpeech.test.js` 使用内存存储和固定随机数，写入以下测试：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPANION_SPEECH_PRIORITY,
  getCompanionCandidate,
  getGreetingPeriod,
  nextIdleSpeechAt,
  pickSpeech,
  readCompanionSpeechState
} from './companionSpeech.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('classifies the four configured greeting periods only', () => {
  assert.equal(getGreetingPeriod(new Date('2026-08-15T09:00:00')), 'morning');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T12:00:00')), 'midday');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T15:00:00')), 'afternoon');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T20:00:00')), 'evening');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T23:00:00')), null);
});

test('schedules idle speech from 45 to 90 minutes', () => {
  assert.equal(nextIdleSpeechAt(1000, () => 0), 2701000);
  assert.equal(nextIdleSpeechAt(1000, () => 0.999999), 5400998);
});

test('does not choose the previous idle sentence when another line exists', () => {
  assert.equal(pickSpeech(['a', 'b'], 0, () => 0), 'b');
});

test('shows each daily greeting once and skips proactive speech when ineligible', () => {
  const local = storage();
  const now = new Date('2026-08-15T09:00:00');
  const first = getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: true, chatOpen: false, asking: false, dragging: false });
  assert.equal(first.kind, 'welcome');
  const greeting = getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: true, chatOpen: false, asking: false, dragging: false });
  assert.equal(greeting.kind, 'greeting');
  assert.equal(getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: false, chatOpen: false, asking: false, dragging: false }), null);
  assert.equal(readCompanionSpeechState('writer', local).greetings['2026-08-15:morning'], true);
});

test('uses per-account state and degrades when storage fails', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => readCompanionSpeechState('writer', broken));
  assert.notEqual(COMPANION_SPEECH_PRIORITY.error, COMPANION_SPEECH_PRIORITY.idle);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test frontend/src/shared/pet/companionSpeech.test.js`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现最小调度器**

创建模块，使用以下明确的状态与规则：

```js
export const COMPANION_SPEECH_PRIORITY = {
  idle: 1,
  greeting: 2,
  welcome: 3,
  click: 4,
  working: 5,
  success: 5,
  error: 6
};

const idleMinDelayMs = 45 * 60 * 1000;
const idleMaxDelayMs = 90 * 60 * 1000;

export function nextIdleSpeechAt(now, random = Math.random) {
  return now + idleMinDelayMs + Math.floor(random() * (idleMaxDelayMs - idleMinDelayMs + 1));
}
```

- 为 `welcome`、四个问候期、`idle`、`click` 定义设计文档中的候选中文台词。
- `getGreetingPeriod()` 使用本地 `Date` 的时与分，边界分别为 08:00–10:30、11:30–13:30、14:00–17:30、18:00–22:30。
- 存储状态为 `{ active: true, welcomed: false, greetings: {}, lastIdleIndex: -1, nextIdleAt: 0 }`；键名使用 `qiantie-cm-companion:<username || 'anonymous'>`。
- 读取或写入异常时返回内存默认状态，不抛出异常。
- 非资格状态返回 `null`；首次符合资格先返回 welcome，随后返回未展示的当前时段 greeting，最后仅在 `now.getTime() >= nextIdleAt` 时返回 idle。
- 每次返回候选项均写回必要状态；点击候选通过单独 `getClickSpeech(previousIndex, random)` 提供，不更新 idle 冷却。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test frontend/src/shared/pet/companionSpeech.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/pet/companionSpeech.js frontend/src/shared/pet/companionSpeech.test.js
git commit -m "feat: add CM companion speech scheduler"
```

## Task 2: 替换任务状态的固定客服文案

**Files:**
- Modify: `frontend/src/shared/pet/stacky.js:22-27`
- Modify: `frontend/src/shared/pet/stacky.test.js:30-38`

**Interfaces:**
- Consumes: 现有 `petSpeech(state)`。
- Produces: `working`、`success`、`error` 的任务台词，供 `StackyPet` 以高优先级任务反馈展示。

- [ ] **Step 1: 修改失败测试期望**

将 `stacky.test.js` 中的断言改为：

```js
assert.equal(petSpeech('working'), '我去把灵感捞回来，别走开。');
assert.equal(petSpeech('success'), '完成！这次故事有点意思。');
assert.equal(petSpeech('error'), '这次灵感没接住，剧本还在，咱们再试试。');
```

保留动画行数和帧数断言。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test frontend/src/shared/pet/stacky.test.js`  
Expected: FAIL，旧固定文案与新期望不一致。

- [ ] **Step 3: 最小实现**

将 `stacky.js` 的 `speech` 映射替换为：

```js
const speech = {
  idle: '',
  working: '我去把灵感捞回来，别走开。',
  success: '完成！这次故事有点意思。',
  error: '这次灵感没接住，剧本还在，咱们再试试。'
};
```

`idle` 留空，确保待机气泡只能由陪伴调度器提供，避免退回“我在，随时开工。”。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test frontend/src/shared/pet/stacky.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/pet/stacky.js frontend/src/shared/pet/stacky.test.js
git commit -m "feat: refresh CM task speech"
```

## Task 3: 在 CM 气泡中接入调度、优先级与生命周期

**Files:**
- Modify: `frontend/src/shared/pet/StackyPet.jsx:1-456`
- Create: `tests/cm-pet-companion-ui-contract.test.js`

**Interfaces:**
- Consumes: `COMPANION_SPEECH_PRIORITY`、`getCompanionCandidate`、`getClickSpeech`、`readCompanionSpeechState`、`writeCompanionSpeechState` 与 `petSpeech(state)`。
- Produces: 在无聊天/请求/拖拽干扰时展示欢迎、问候和随机台词；任务状态总是替换普通台词。

- [ ] **Step 1: 编写失败 UI 契约测试**

创建 `tests/cm-pet-companion-ui-contract.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('CM integrates proactive companion speech without interrupting chat or tasks', () => {
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  assert.match(pet, /getCompanionCandidate/);
  assert.match(pet, /COMPANION_SPEECH_PRIORITY/);
  assert.match(pet, /document\.visibilityState === 'visible'/);
  assert.match(pet, /!chatOpen && !asking && !dragRef\.current/);
  assert.match(pet, /window\.setTimeout\(/);
  assert.match(pet, /window\.clearTimeout\(/);
  assert.match(pet, /priority >= current\.priority/);
  assert.match(pet, /getClickSpeech/);
  assert.match(pet, /if \(draggedRef\.current\)/);
  assert.match(pet, /reply \|\| petSpeech\(state\)/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/cm-pet-companion-ui-contract.test.js`  
Expected: FAIL，尚未导入调度器。

- [ ] **Step 3: 实现气泡状态与调度 Effect**

在 `StackyPet.jsx`：

```js
const companionBubbleDurationMs = 7000;
const [companionSpeech, setCompanionSpeech] = useState(null);
const companionSpeechRef = useRef(null);
const companionTimerRef = useRef(null);
```

添加 `showCompanionSpeech(candidate)`：

- 若当前 `reply` 是任务状态台词，或 `candidate.priority` 低于 `companionSpeechRef.current?.priority`，则不替换。
- 设置 `{ text, priority }`，并清除旧计时器。
- `priority <= COMPANION_SPEECH_PRIORITY.click` 时设置 7000 毫秒自动清除；任务反馈仍沿用现有 reset state 计时机制。

添加一个依赖 `username, accountSessionKey, chatOpen, asking, state` 的 `useEffect`：

- 只在 `state === 'idle'` 时调度主动台词。
- 监听 `visibilitychange`；页面隐藏时清除下一次计时器，恢复可见时立即检查资格。
- 使用 `getCompanionCandidate({ now: new Date(), username, storage: window.localStorage, active: readCompanionSpeechState(username).active, visible: document.visibilityState === 'visible', chatOpen, asking, dragging: Boolean(dragRef.current) })`。
- 有候选则 `showCompanionSpeech(candidate)`；没有候选时，安排一个最多不超过下一次随机时点的单个定时器，页面隐藏、卸载、账号切换时清理。
- 任务状态事件、`sendQuestion()` 进入 working、成功或 error 时，清除普通 `companionSpeech`，由 `reply || petSpeech(state)` 显示高优先级任务反馈。
- 在 `handlePetClick()` 中，调用 `getClickSpeech()` 并通过 `showCompanionSpeech()` 显示后仍打开聊天；如果聊天已打开则不发点击台词。
- 在气泡 JSX 处改为：

```jsx
<div className="stacky-pet-bubble">{reply || petSpeech(state) || companionSpeech?.text}</div>
```

为保证欢迎先出现，气泡优先级值中的 `reply`/非 idle 状态总是高于 `companionSpeech`。

- [ ] **Step 4: 运行组件契约和现有宠物测试**

Run: `node --test tests/cm-pet-companion-ui-contract.test.js frontend/src/shared/pet/stacky.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/pet/StackyPet.jsx tests/cm-pet-companion-ui-contract.test.js
git commit -m "feat: schedule CM companion bubbles"
```

## Task 4: 添加本地“宠物主动说话”设置开关

**Files:**
- Modify: `frontend/src/user/pages/SettingsPage.jsx:1-175`
- Modify: `tests/cm-pet-companion-ui-contract.test.js`

**Interfaces:**
- Consumes: `readCompanionSpeechState(username, storage)` 与 `writeCompanionSpeechState(username, state, storage)`；通过现有 `getCurrentUsername()` 从 `auth_username` 取得当前账号。
- Produces: 仅浏览器本地保存的 boolean `active`，被 `StackyPet` 下一次调度读取。

- [ ] **Step 1: 扩展失败 UI 契约测试**

在现有测试增加：

```js
test('settings exposes a local CM proactive speech switch', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  assert.match(settings, /宠物主动说话/);
  assert.match(settings, /Switch/);
  assert.match(settings, /writeCompanionSpeechState/);
  assert.doesNotMatch(settings, /active: values\.active/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/cm-pet-companion-ui-contract.test.js`  
Expected: FAIL，设置页还未显示开关。

- [ ] **Step 3: 实现最小本地开关**

- 从 `antd` 导入 `Switch`，并从 `companionSpeech.js` 导入读写函数。
- 从 `../../shared/api/auth` 导入现有 `getCurrentUsername()`，并用 `const username = getCurrentUsername();` 取得当前账号；不新建服务端字段或请求。
- 加载设置时读取 `{ active }`；默认 `true`。
- 在“模型与助手”区域、宠物预览后新增：

```jsx
<Form.Item label="宠物主动说话" valuePropName="checked">
  <Switch checked={companionActive} onChange={checked => {
    setCompanionActive(checked);
    writeCompanionSpeechState(username, { ...readCompanionSpeechState(username), active: checked, nextIdleAt: 0 });
  }} />
</Form.Item>
```

- 不把 `active` 放入 `saveConfig()` 请求体；这是纯本地、账号隔离的展示偏好。
- 切换后使用 `window.dispatchEvent(new CustomEvent(PET_COMPANION_SETTINGS_EVENT, { detail: { active: checked, username } }))` 通知同一标签页的 `StackyPet`；`StackyPet` 在收到关闭事件时清除普通气泡并取消主动计时器。任务状态反馈不受影响。

- [ ] **Step 4: 运行相关测试**

Run: `node --test tests/cm-pet-companion-ui-contract.test.js frontend/src/shared/pet/companionSpeech.test.js frontend/src/shared/pet/stacky.test.js`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/user/pages/SettingsPage.jsx tests/cm-pet-companion-ui-contract.test.js
git commit -m "feat: add CM companion speech preference"
```

## Task 5: 全量前端与回归验证

**Files:**
- Modify: 无，除非回归测试揭示本计划范围内问题。

**Interfaces:**
- Consumes: Tasks 1–4 的完成实现。
- Produces: 可验证的 CM 陪伴台词功能，不影响现有 CM 剧本协作。

- [ ] **Step 1: 运行所有宠物和协作聚焦测试**

Run:

```bash
node --test frontend/src/shared/pet/companionSpeech.test.js frontend/src/shared/pet/stacky.test.js tests/cm-pet-companion-ui-contract.test.js tests/cm-agent-ui-contract.test.js tests/agent-routes.test.js
```

Expected: PASS。

- [ ] **Step 2: 运行前端构建**

Run: `npm run frontend:build`  
Expected: 退出码 `0`；可接受现有 Vite bundle-size 警告，不能出现编译错误。

- [ ] **Step 3: 手动验收**

使用已登录账号打开任意工作台页面，验证：

1. 首次进入显示一条欢迎台词；刷新不会重复欢迎。
2. 在早、午、下午、晚间进入，当前时段问候每天只出现一次。
3. 打开聊天、发送请求、拖拽、切走浏览器标签时没有主动气泡打断。
4. 关闭“宠物主动说话”后，欢迎、问候、随机和点击台词停止；生成和报错仍展示任务反馈。
5. 在设置页重新开启后，随机台词重新计时，不补发关闭期间台词。
6. 生成成功与人为断网失败时，任务反馈覆盖闲聊；剧本协作的预览、应用、撤销仍可用。

- [ ] **Step 4: 提交验证中发现的范围内修复**

仅当验证修复了本计划范围内的代码时，按实际修改文件暂存并提交；例如仅修改气泡行为时：

```bash
git add frontend/src/shared/pet/StackyPet.jsx tests/cm-pet-companion-ui-contract.test.js
git commit -m "fix: polish CM companion speech behavior"
```
