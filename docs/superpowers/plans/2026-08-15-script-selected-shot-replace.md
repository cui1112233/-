# 已选分镜卡片文字替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在剧本生成页中，仅对已勾选的分镜卡片提供查找、定位、替换当前与全部替换能力。

**Architecture:** 将文本范围计算和替换写成无 UI 依赖的 `scriptShotReplace.js` 纯函数。`ScriptPage` 保存查找词、替换词和当前匹配项；工具栏打开 Ant Design 弹窗，弹窗只显示和操作来自已选卡片的匹配项。替换后的完整文本统一经 `updateOutputDraft()` 写回，以延续草稿保存和卡片重新计算。

**Tech Stack:** React 18、Ant Design、JavaScript ES Modules、Node.js 内置测试运行器。

## Global Constraints

- 查找和替换仅作用于 `selectedShotIndexes` 指定的分镜卡片。
- 使用普通文本精确匹配；不提供正则表达式或大小写选项。
- 不调用 AI 或新增后端接口。
- 所有正文写入必须经 `updateOutputDraft(nextOutput)`，不得直接调用 `setOutput()`。
- 任何单项改动的测试通过后立即创建只包含该项文件的 Git 提交。

---

### Task 1: 已选分镜匹配与替换纯函数

**Files:**
- Create: `frontend/src/user/pages/scriptShotReplace.js`
- Test: `tests/script-shot-replace.test.js`

**Interfaces:**
- Consumes: `output: string`、`cards: string[]`、`selectedIndexes: Set<number>`、`findText: string`、`replaceText: string`。
- Produces: `getSelectedShotMatches(output, cards, selectedIndexes, findText): Array<{ cardIndex: number, start: number, end: number }>`，其中 `start` / `end` 是完整 `output` 内每个匹配词的半开区间。
- Produces: `replaceSelectedShotMatch(output, match, replaceText): string`。
- Produces: `replaceAllSelectedShotMatches(output, matches, replaceText): string`。

- [ ] **Step 1: 写出失败的单元测试**

创建 `tests/script-shot-replace.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('只返回已选分镜卡片中的匹配位置', async () => {
  const { getSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const first = '### 分镜一\n角色：阿明';
  const second = '### 分镜二\n角色：阿明';
  const output = `${first}\n\n---\n\n${second}`;

  assert.deepEqual(getSelectedShotMatches(output, [first, second], new Set([1]), '阿明'), [
    { cardIndex: 1, start: output.lastIndexOf('阿明'), end: output.lastIndexOf('阿明') + 2 }
  ]);
});

test('替换当前匹配项且不改动其他卡片', async () => {
  const { getSelectedShotMatches, replaceSelectedShotMatch } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const cards = ['### 分镜一\n阿明', '### 分镜二\n阿明'];
  const output = cards.join('\n\n---\n\n');
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');

  assert.equal(replaceSelectedShotMatch(output, match, '小明'), '### 分镜一\n阿明\n\n---\n\n### 分镜二\n小明');
});

test('全部替换仅替换多个已选卡片并从后向前保持坐标正确', async () => {
  const { getSelectedShotMatches, replaceAllSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const cards = ['### 分镜一\n阿明与阿明', '### 分镜二\n阿明', '### 分镜三\n阿明'];
  const output = cards.join('\n\n---\n\n');
  const matches = getSelectedShotMatches(output, cards, new Set([0, 2]), '阿明');

  assert.equal(replaceAllSelectedShotMatches(output, matches, '小明'), '### 分镜一\n小明与小明\n\n---\n\n### 分镜二\n阿明\n\n---\n\n### 分镜三\n小明');
});

test('空查询、空选择和找不到文本均不返回匹配项', async () => {
  const { getSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set([0]), ''), []);
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set(), '分镜'), []);
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set([0]), '不存在'), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-shot-replace.test.js`

Expected: FAIL，提示无法导入 `scriptShotReplace.js`。

- [ ] **Step 3: 实现最小纯函数模块**

创建 `frontend/src/user/pages/scriptShotReplace.js`，实现：

```js
function cardRanges(output, cards) {
  let cursor = 0;
  return cards.map(card => {
    const start = output.indexOf(card, cursor);
    if (start < 0) return null;
    cursor = start + card.length;
    return { start, end: cursor };
  });
}

export function getSelectedShotMatches(output, cards, selectedIndexes, findText) {
  if (!findText || !selectedIndexes?.size) return [];
  return cardRanges(output, cards).flatMap((range, cardIndex) => {
    if (!range || !selectedIndexes.has(cardIndex)) return [];
    const card = output.slice(range.start, range.end);
    const matches = [];
    let offset = 0;
    while (offset <= card.length - findText.length) {
      const index = card.indexOf(findText, offset);
      if (index < 0) break;
      matches.push({ cardIndex, start: range.start + index, end: range.start + index + findText.length });
      offset = index + findText.length;
    }
    return matches;
  });
}

export function replaceSelectedShotMatch(output, match, replaceText) {
  return `${output.slice(0, match.start)}${replaceText}${output.slice(match.end)}`;
}

export function replaceAllSelectedShotMatches(output, matches, replaceText) {
  return [...matches].sort((left, right) => right.start - left.start).reduce(
    (next, match) => replaceSelectedShotMatch(next, match, replaceText),
    output
  );
}
```

- [ ] **Step 4: 运行单元测试确认通过**

Run: `node --test tests/script-shot-replace.test.js`

Expected: PASS，4 个测试全部通过。

- [ ] **Step 5: 提交纯函数和测试**

```bash
git add -- frontend/src/user/pages/scriptShotReplace.js tests/script-shot-replace.test.js
git commit -m "feat: add selected shot text replacement helpers"
```

### Task 2: 在剧本页加入已选卡片替换弹窗

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:1-18,77-115,173-177,774-833`
- Modify: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- Consumes: Task 1 的 `getSelectedShotMatches`、`replaceSelectedShotMatch`、`replaceAllSelectedShotMatches`。
- Consumes: `shotCards: string[]`、`selectedShotIndexes: Set<number>`、`updateOutputDraft(nextOutput)`。
- Produces: 工具栏“查找替换”入口和仅针对已选卡片的 `Modal` 交互。

- [ ] **Step 1: 扩展失败的 UI 契约测试**

在 `tests/script-shot-output-ui-contract.test.js` 末尾添加：

```js
test('script page provides find and replace only for selected shot cards', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /查找替换/);
  assert.match(page, /selectedShotIndexes\.size/);
  assert.match(page, /getSelectedShotMatches/);
  assert.match(page, /replaceSelectedShotMatch/);
  assert.match(page, /replaceAllSelectedShotMatches/);
  assert.match(page, /updateOutputDraft\(nextOutput\)/);
  assert.match(page, /Modal/);
});
```

- [ ] **Step 2: 运行 UI 契约测试确认失败**

Run: `node --test tests/script-shot-output-ui-contract.test.js`

Expected: FAIL，找不到“查找替换”或纯函数名称。

- [ ] **Step 3: 添加页面状态与匹配派生值**

在 `ScriptPage.jsx` 导入 Task 1 的三个函数。紧邻 `selectedShotIndexes` 状态添加：

```js
const [shotReplaceOpen, setShotReplaceOpen] = useState(false);
const [shotFindText, setShotFindText] = useState('');
const [shotReplaceText, setShotReplaceText] = useState('');
const [shotMatchIndex, setShotMatchIndex] = useState(0);
```

紧邻 `shotCards` 的 `useMemo` 添加：

```js
const selectedShotMatches = useMemo(
  () => getSelectedShotMatches(output, shotCards, selectedShotIndexes, shotFindText),
  [output, shotCards, selectedShotIndexes, shotFindText]
);
const activeShotMatch = selectedShotMatches[shotMatchIndex] || null;
```

添加一个 effect，在匹配数变化时将当前索引限制到有效区间；没有匹配时设为 `0`：

```js
useEffect(() => {
  setShotMatchIndex(index => selectedShotMatches.length ? Math.min(index, selectedShotMatches.length - 1) : 0);
}, [selectedShotMatches.length]);
```

- [ ] **Step 4: 添加替换操作函数**

在 `updateOutputDraft()` 后添加：

```js
function replaceCurrentShotMatch() {
  if (!activeShotMatch) return;
  const nextOutput = replaceSelectedShotMatch(output, activeShotMatch, shotReplaceText);
  updateOutputDraft(nextOutput);
}

function replaceAllShotMatches() {
  if (!selectedShotMatches.length) return;
  const nextOutput = replaceAllSelectedShotMatches(output, selectedShotMatches, shotReplaceText);
  updateOutputDraft(nextOutput);
}
```

将 `updateOutputDraft()` 扩展为在替换操作完成后不丢失卡片选择：新增可选的第二参数 `preserveSelectedShots = false`。默认维持原行为清空选中；当替换操作调用时传入 `true`，并用新卡片数量过滤当前索引。调用形态为：

```js
function updateOutputDraft(nextOutput, preserveSelectedShots = false) {
  setOutput(nextOutput);
  if (!preserveSelectedShots) setSelectedShotIndexes(new Set());
  persistDraft(undefined, { output: nextOutput });
}
```

替换函数分别改为 `updateOutputDraft(nextOutput, true)`。

- [ ] **Step 5: 添加工具栏入口与 Modal 内容**

在现有工具栏“复制”和“编辑”按钮之间加入：

```jsx
<Button disabled={!isShotCardView || !selectedShotIndexes.size} onClick={() => setShotReplaceOpen(true)}>查找替换</Button>
```

在页面现有 Modal 区域添加一个受控 `Modal`。它必须：
- 标题为“替换已选分镜文字”；
- 在标题下方显示 `已选 ${selectedShotIndexes.size} 条分镜`；
- 有 `Input` 控制“查找内容”和“替换为”；
- 显示空查询时“请输入查找内容”、无结果时“未找到匹配内容”、有结果时 `${shotMatchIndex + 1} / ${selectedShotMatches.length}`；
- “上一个”“下一个”通过模运算更新 `shotMatchIndex`；
- “替换当前”仅在 `activeShotMatch` 存在时可用；
- “全部替换”仅在 `selectedShotMatches.length > 0` 时可用；
- 关闭时仅关闭弹窗，不修改 `output`。

使用以下动作区域：

```jsx
<Space wrap>
  <Button disabled={!selectedShotMatches.length} onClick={() => setShotMatchIndex(index => (index - 1 + selectedShotMatches.length) % selectedShotMatches.length)}>上一个</Button>
  <Button disabled={!selectedShotMatches.length} onClick={() => setShotMatchIndex(index => (index + 1) % selectedShotMatches.length)}>下一个</Button>
  <Button disabled={!activeShotMatch} onClick={replaceCurrentShotMatch}>替换当前</Button>
  <Button type="primary" disabled={!selectedShotMatches.length} onClick={replaceAllShotMatches}>全部替换</Button>
</Space>
```

- [ ] **Step 6: 运行相关测试确认通过**

Run: `node --test tests/script-shot-replace.test.js tests/script-shot-output.test.js tests/script-shot-output-ui-contract.test.js`

Expected: PASS，所有测试通过。

- [ ] **Step 7: 构建前端**

Run: `npm --prefix frontend run build`

Expected: exit code 0；仅允许已有的 chunk size 警告。

- [ ] **Step 8: 提交页面功能和 UI 契约测试**

```bash
git add -- frontend/src/user/pages/ScriptPage.jsx tests/script-shot-output-ui-contract.test.js
git commit -m "feat: replace text in selected shot cards"
```
