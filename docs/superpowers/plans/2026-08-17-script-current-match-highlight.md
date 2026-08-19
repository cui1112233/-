# 剧本当前匹配项高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在查找替换弹窗打开时，在分镜卡片正文中高亮当前定位的唯一匹配项，并将对应卡片滚动到可见区域。

**Architecture:** 在既有 `scriptShotReplace.js` 中为每个 JSON 匹配生成卡片显示文本内的半开区间：复制分镜对象、在命中的字符串字段位置写入唯一安全标记、用与卡片一致的 `JSON.stringify(shot, null, 2)` 序列化后取得标记位置。普通文本分镜通过原始输出坐标换算。`ScriptPage` 仅在弹窗打开时把当前匹配传给 `ShotOutputCards`；组件使用纯函数拆分文本、渲染 `<mark>` 并滚动定位。

**Tech Stack:** React 18、Ant Design、Node.js built-in test runner、Vite、现有 CSS 变量。

## Global Constraints

- 只高亮已选分镜中的当前匹配项，不高亮其他匹配项或未选分镜。
- 弹窗关闭、查找内容为空或没有匹配时不得显示高亮。
- 高亮不得修改 `output`、卡片选择、复制结果、查找范围或替换逻辑。
- JSON 分镜必须依据匹配对象已有元数据及序列化安全标记计算显示区间，不根据格式化展示文本二次搜索。
- 当前匹配卡片自动滚动到可见区域；保留现有等宽文本、换行和卡片布局。
- 不增加第三方编辑器或搜索依赖。
- 每个任务完成验证后只提交该任务涉及的文件。

---

### Task 1: 当前匹配显示区间与高亮片段纯函数

**Files:**
- Create: `frontend/src/user/components/shotTextHighlight.js`
- Modify: `frontend/src/user/pages/scriptShotReplace.js`
- Create: `tests/shot-text-highlight.test.js`
- Modify: `tests/script-shot-replace.test.js`

**Interfaces:**
- Produces: `getShotMatchDisplayRange(card, cardIndex, cardStart, activeMatch)` from `scriptShotReplace.js`, returning `{ start: number, end: number } | null` in the displayed card string.
- Produces: `splitShotTextHighlight(card, displayRange)` from `shotTextHighlight.js`, returning `{ before: string, highlight: string, after: string } | null`.
- Consumes: `activeMatch` shape `{ cardIndex: number, start: number, end: number }`, optionally carrying the existing private JSON match metadata.

- [ ] **Step 1: 写出失败的纯函数测试**

创建 `tests/shot-text-highlight.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('将显示文本中的半开区间切分为高亮片段', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.deepEqual(
    splitShotTextHighlight('角色：阿明出场', { start: 3, end: 5 }),
    { before: '角色：', highlight: '阿明', after: '出场' }
  );
});

test('缺失或越界区间不生成高亮', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.equal(splitShotTextHighlight('阿明', null), null);
  assert.equal(splitShotTextHighlight('阿明', { start: 0, end: 3 }), null);
  assert.equal(splitShotTextHighlight('阿明', { start: 2, end: 2 }), null);
});

test('支持高亮位于显示文本开头和结尾', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.deepEqual(splitShotTextHighlight('阿明出场', { start: 0, end: 2 }), { before: '', highlight: '阿明', after: '出场' });
  assert.deepEqual(splitShotTextHighlight('角色阿明', { start: 2, end: 4 }), { before: '角色', highlight: '阿明', after: '' });
});
```

在 `tests/script-shot-replace.test.js` 中新增：

```js
test('JSON 匹配能返回格式化卡片内的显示区间', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{\n  "shots": [\n    { "text": "阿明" },\n    {\n      "text": "阿明出场"\n    }\n  ]\n}';
  const cards = getShotCards('storyboard', output);
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');
  const range = getShotMatchDisplayRange(output, cards[1], 1, null, match);
  assert.equal(cards[1].slice(range.start, range.end), '阿明');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/shot-text-highlight.test.js tests/script-shot-replace.test.js`

Expected: FAIL，因为新模块和 `getShotMatchDisplayRange` 尚不存在。

- [ ] **Step 3: 实现最小显示区间与切分函数**

创建 `frontend/src/user/components/shotTextHighlight.js`：

```js
export function splitShotTextHighlight(card, displayRange) {
  if (!displayRange) return null;
  const { start, end } = displayRange;
  if (start < 0 || end <= start || end > card.length) return null;
  return {
    before: card.slice(0, start),
    highlight: card.slice(start, end),
    after: card.slice(end)
  };
}
```

在 `frontend/src/user/pages/scriptShotReplace.js` 新增并导出：

```js
export function getShotMatchDisplayRange(output, card, cardIndex, cardStart, match) {
  if (!match || match.cardIndex !== cardIndex) return null;
  const metadata = match[jsonMatchMetadata];
  if (!metadata) {
    const start = match.start - cardStart;
    const end = match.end - cardStart;
    return start >= 0 && end <= card.length && end > start ? { start, end } : null;
  }
  const shots = getJsonShots(output)?.shots;
  const shot = shots?.[cardIndex];
  if (!shot) return null;
  const marker = '__SHOT_MATCH_MARKER__';
  const copy = structuredClone(shot);
  const value = getValueAtPath(copy, metadata.path);
  setValueAtPath(copy, metadata.path, `${value.slice(0, metadata.offset)}${marker}${value.slice(metadata.offset + metadata.length)}`);
  const marked = JSON.stringify(copy, null, 2);
  const start = marked.indexOf(marker);
  if (start < 0) return null;
  return { start, end: start + metadata.length };
}
```

实现时使用与 `getShotCards()` 相同的 `JSON.stringify(shot, null, 2)` 展示格式。安全标记必须在测试中证明不会出现在该次卡片文本中；若出现则生成新的唯一标记。替换函数仍使用原有 `metadata`，不得改为使用高亮计算结果。

- [ ] **Step 4: 运行纯函数测试确认通过**

Run: `node --test tests/shot-text-highlight.test.js tests/script-shot-replace.test.js`

Expected: 所有测试通过。

- [ ] **Step 5: 提交 Task 1**

```powershell
git add -- frontend/src/user/components/shotTextHighlight.js frontend/src/user/pages/scriptShotReplace.js tests/shot-text-highlight.test.js tests/script-shot-replace.test.js
git commit -m "feat: add current shot match highlighter"
```

### Task 2: 卡片高亮渲染与滚动定位

**Files:**
- Modify: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- Consumes: `getShotMatchDisplayRange` from `frontend/src/user/pages/scriptShotReplace.js` and `splitShotTextHighlight` from `frontend/src/user/components/shotTextHighlight.js`.
- Extends `ShotOutputCards` props with `activeMatch: { cardIndex: number, start: number, end: number } | null`, `cardStarts: Array<number | null>`, and `output: string`.
- `ScriptPage` supplies `activeMatch` only when `shotReplaceOpen` is true; otherwise it supplies `null`.

- [ ] **Step 1: 扩展 UI 契约测试并先确认失败**

在 `tests/script-shot-output-ui-contract.test.js` 的查找替换测试中追加断言：

```js
assert.match(page, /activeMatch=\{shotReplaceOpen \? activeShotMatch : null\}/);
assert.match(cards, /getShotMatchDisplayRange/);
assert.match(cards, /splitShotTextHighlight/);
assert.match(cards, /shot-output-card-match/);
assert.match(cards, /scrollIntoView/);
```

Run: `node --test tests/script-shot-output-ui-contract.test.js`

Expected: FAIL，因为当前页面没有把 `activeMatch` 传给卡片，卡片也没有高亮和滚动实现。

- [ ] **Step 2: 在 `ScriptPage.jsx` 提供普通文本卡片起点和高亮状态**

在 `scriptShotReplace.js` 导出 `getShotCardStarts(output, cards)`。对于普通文本卡片，按现有 `cardRanges` 的顺序查找逻辑返回每张卡片的 `start`；对 JSON 输出返回同长度的 `null` 数组，因为 JSON 使用匹配私有元数据计算显示位置。

在 `scriptShotReplace.js` 新增并导出：

```js
export function getShotCardStarts(output, cards) {
  if (getJsonShots(output)) return cards.map(() => null);
  return cardRanges(output, cards).map(range => range?.start ?? null);
}
```

在 `ScriptPage.jsx` 中增加：

```js
const shotCardStarts = useMemo(
  () => getShotCardStarts(output, shotCards),
  [output, shotCards]
);
```

并向 `ShotOutputCards` 传递：

```jsx
output={output}
activeMatch={shotReplaceOpen ? activeShotMatch : null}
cardStarts={shotCardStarts}
```

保持 `activeShotMatch` 的现有来源，不改变查找、替换和保存函数。

- [ ] **Step 3: 在 `ShotOutputCards.jsx` 渲染当前匹配并滚动**

- 从 React 导入 `useEffect`、`useRef`；导入 `splitShotTextHighlight` 与 `getShotMatchDisplayRange`。
- 为当前高亮元素创建 `ref`，在 `activeMatch` 改变时执行：

```js
useEffect(() => {
  activeMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}, [activeMatch]);
```

- 每个卡片调用：

```js
const displayRange = getShotMatchDisplayRange(output, card, index, cardStarts[index], activeMatch);
const highlight = splitShotTextHighlight(card, displayRange);
```

- `highlight` 为 `null` 时继续渲染原始 `card`；否则在原有 `<pre>` 中按顺序渲染 `before`、`<mark className="shot-output-card-match" ref={activeMatchRef}>highlight</mark>`、`after`。
- 不给未高亮卡片增加标记，不改变复制、勾选、工具栏与卡片 key。

- [ ] **Step 4: 添加高亮样式**

在 `frontend/src/shared/styles/global.css` 的 `.shot-output-card-content` 相邻位置添加：

```css
.shot-output-card-match {
  background: #ffe58f;
  color: #3b2d00;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
```

不得改变 `.shot-output-card-content` 的字体、换行、滚动和布局规则。

- [ ] **Step 5: 运行完整功能验证**

Run:

```powershell
node --test tests/shot-text-highlight.test.js tests/script-shot-replace.test.js tests/script-shot-output.test.js tests/script-shot-output-ui-contract.test.js
npm --prefix frontend run build
git diff --check
```

Expected:
- 所有 Node 测试通过。
- Vite 构建退出码为 0；既有大 chunk 警告可以存在。
- `git diff --check` 无空白错误。

- [ ] **Step 6: 提交 Task 2**

```powershell
git add -- frontend/src/user/components/ShotOutputCards.jsx frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/scriptShotReplace.js frontend/src/shared/styles/global.css tests/script-shot-output-ui-contract.test.js
git commit -m "feat: highlight current selected shot match"
```

## Self-Review

- 规格中的唯一高亮、弹窗关闭不显示、空查找/无匹配不显示、自动滚动、黄色可读样式和不改变替换逻辑均由 Task 2 覆盖。
- 普通文本与 JSON 分镜分别通过原始坐标和既有 JSON 匹配元数据计算显示区间，避免格式化差异导致错位。
- 纯函数的空值、越界和首尾匹配均由 Task 1 覆盖。
- 没有新增依赖；高亮渲染仅在现有分镜卡片视图中生效。
