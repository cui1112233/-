# 剧本分镜卡片输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将非剧本模式的多分镜输出显示为可单独或批量复制的分镜卡片，同时保留剧本模式的完整编辑框。

**Architecture:** 新增纯解析模块，先解析 JSON 分镜数组，再按编号标题拆分文本，至少两条才进入卡片视图。新增卡片组件负责选择与复制；`ScriptPage` 继续保存原始输出、控制编辑并在卡片和原文视图间切换。

**Tech Stack:** React、Ant Design、lucide-react、Node.js 内置测试、Vite。

## Global Constraints

- 不新增第三方依赖。
- `shortdrama` 剧本模式始终使用完整输出框。
- 只在非 `shortdrama` 模式且可靠识别至少 2 条分镜时显示卡片。
- 单条复制只复制该分镜正文；批量复制按原顺序，以两个换行分隔，不追加标题。
- 原始输出是草稿与历史唯一保存值，卡片是派生显示状态。
- 无法拆分时必须安全回退完整文本框。
- 不添加代码注释。
- 不提交 Git 提交；仅由用户明确要求时提交。

---

## 文件结构

- 创建 `frontend/src/user/pages/scriptShotOutput.js`：输出解析、模式判断和复制文本组合纯函数。
- 创建 `frontend/src/user/components/ShotOutputCards.jsx`：分镜卡片的选择与复制视图。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：根据格式与解析结果切换输出视图、管理选中项。
- 修改 `frontend/src/shared/styles/global.css`：分镜卡片、工具栏和移动端布局样式。
- 创建 `tests/script-shot-output.test.js`：纯函数测试。
- 创建 `tests/script-shot-output-ui-contract.test.js`：页面与卡片组件契约测试。

### Task 1: 分镜输出解析与复制纯函数

**Files:**
- Create: `frontend/src/user/pages/scriptShotOutput.js`
- Create: `tests/script-shot-output.test.js`

**Interfaces:**
- Produces `isShotCardFormat(format) -> boolean`。
- Produces `parseShotOutput(output) -> string[]`。
- Produces `getShotCards(format, output) -> string[]`。
- Produces `joinShotCards(cards, selectedIndexes) -> string`。

- [ ] **Step 1: 写入失败测试**

```js
test('parses JSON shot arrays, numbered shot text and safely keeps unsplittable output intact', async () => {
  const { getShotCards, joinShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  assert.deepEqual(getShotCards('shotlist', '{"shots":[{"prompt":"A"},{"prompt":"B"}]}'), ['{"prompt":"A"}', '{"prompt":"B"}']);
  assert.deepEqual(getShotCards('storyboard', '分镜 1：雨夜\n画面一\n\n分镜 2：室内\n画面二'), ['分镜 1：雨夜\n画面一', '分镜 2：室内\n画面二']);
  assert.deepEqual(getShotCards('shortdrama', '分镜 1：A\n分镜 2：B'), []);
  assert.deepEqual(getShotCards('screenplay', '只有一段内容'), []);
  assert.equal(joinShotCards(['一', '二', '三'], new Set([0, 2])), '一\n\n三');
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-shot-output.test.js`

预期：失败，因为模块不存在。

- [ ] **Step 3: 实现解析工具**

```js
const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
const SHOT_HEADING = /^(?:#{1,6}\s*)?(?:分镜|镜头|场景|shot)\s*[第#]?\s*\d+\s*[：:.、]/im;

export function isShotCardFormat(format) {
  return format !== 'shortdrama';
}

export function getShotCards(format, output) {
  if (!isShotCardFormat(format)) return [];
  const cards = parseShotOutput(output);
  return cards.length >= 2 ? cards : [];
}

export function joinShotCards(cards, selectedIndexes) {
  return cards.filter((_, index) => selectedIndexes.has(index)).join('\n\n');
}
```

`parseShotOutput` 先尝试 JSON 顶层数组和 `SHOT_ARRAY_KEYS`，每项用 `JSON.stringify(item, null, 2)` 格式化；失败时按 `SHOT_HEADING` 的匹配位置切片并 `trim()` 过滤空项。

- [ ] **Step 4: 运行解析测试确认通过**

运行：`node --test tests/script-shot-output.test.js`

预期：通过。

### Task 2: 分镜卡片组件与样式

**Files:**
- Create: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Create: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- Consumes `cards: string[]`、`selectedIndexes: Set<number>`、`onToggle(index)`、`onToggleAll()`、`onCopy(card)`、`onCopySelected()`。
- Produces `ShotOutputCards` React 组件。

- [ ] **Step 1: 写入失败组件契约测试**

```js
test('shot card component provides individual, selected and all-copy controls', () => {
  assert.match(cards, /复制本分镜/);
  assert.match(cards, /复制已选/);
  assert.match(cards, /全选/);
  assert.match(cards, /Checkbox/);
  assert.match(page, /ShotOutputCards/);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/script-shot-output-ui-contract.test.js`

预期：失败，因为卡片组件不存在。

- [ ] **Step 3: 实现卡片组件**

使用 Ant Design `Button`、`Checkbox`、`Space`，每张卡呈现：

```jsx
<div className="shot-output-card" key={index}>
  <div className="shot-output-card-header">
    <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1}</Checkbox>
    <Button size="small" icon={<Copy size={15} />} onClick={() => onCopy(card)}>复制本分镜</Button>
  </div>
  <pre className="shot-output-card-content">{card}</pre>
</div>
```

顶部显示已选条数，提供全选/取消全选和“复制已选”；无选中项时禁用“复制已选”。

- [ ] **Step 4: 添加样式**

在 `global.css` 添加 `.shot-output-toolbar`、`.shot-output-cards`、`.shot-output-card`、`.shot-output-card-header`、`.shot-output-card-content`。卡片保持现有暗色变量、等宽换行文本、边框和移动端单列布局；不覆盖 `.legacy-output`。

- [ ] **Step 5: 运行组件契约测试确认通过**

运行：`node --test tests/script-shot-output-ui-contract.test.js`

预期：通过。

### Task 3: 集成剧本结果区与复制行为

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- Consumes `getShotCards(format, output)`、`joinShotCards(cards, selectedIndexes)` 和 `ShotOutputCards`。
- `copyText(text)` 统一调用 `navigator.clipboard.writeText(text)` 并在成功时显示 `message.success('已复制')`。

- [ ] **Step 1: 扩展失败契约测试**

```js
test('script page uses card output only for parsed non-shortdrama results', () => {
  assert.match(page, /getShotCards\(selectedFormat, output\)/);
  assert.match(page, /shotCards\.length/);
  assert.match(page, /setEditingOutput\(true\)/);
  assert.match(page, /joinShotCards/);
});
```

- [ ] **Step 2: 运行页面契约测试确认失败**

运行：`node --test tests/script-shot-output-ui-contract.test.js`

预期：失败，因为页面还只有单一文本框。

- [ ] **Step 3: 添加派生卡片和选择状态**

在 `ScriptPage` 增加：

```js
const [selectedShotIndexes, setSelectedShotIndexes] = useState(new Set());
const shotCards = useMemo(() => getShotCards(selectedFormat, output), [selectedFormat, output]);
const isShotCardView = shotCards.length > 0 && !editingOutput;
```

在新生成结果、编辑原文、实体变更、格式切换时 `setSelectedShotIndexes(new Set())`。复制函数使用 `navigator.clipboard?.writeText`，为空或 API 不可用时显示失败提示。

- [ ] **Step 4: 连接工具栏与结果区**

主“复制”按钮在卡片视图复制 `shotCards.join('\n\n')`，其他情况复制原始 `output`。卡片视图渲染 `ShotOutputCards`，否则沿用 `Input.TextArea`。点击编辑时先清空卡片选择再进入完整文本框；完成编辑后自动按最新文本解析。

- [ ] **Step 5: 运行定向测试**

运行：

```powershell
node --test tests/script-shot-output.test.js tests/script-shot-output-ui-contract.test.js tests/script-draft-persistence-contract.test.js
```

预期：全部通过。

### Task 4: 全量验证

**Files:**
- Modify: 仅为修复验证发现的问题修改上述文件。

- [ ] **Step 1: 运行剧本相关测试**

运行：

```powershell
node --test tests/script-shot-output.test.js tests/script-shot-output-ui-contract.test.js tests/script-draft-persistence-contract.test.js tests/script-entity-management.test.js tests/script-protagonist-generation-contract.test.js
```

预期：全部通过。

- [ ] **Step 2: 构建前端**

运行：`npm --prefix frontend run build`

预期：Vite 构建成功。

- [ ] **Step 3: 检查诊断**

检查 `scriptShotOutput.js`、`ShotOutputCards.jsx` 与 `ScriptPage.jsx`，预期无诊断错误。

- [ ] **Step 4: 浏览器验收**

在画布、剧情或分镜模式中生成至少三个编号分镜：确认三张卡片、单条复制、选中两条批量复制、全选和取消全选均可用。切换到剧本模式确认仍是一个完整可编辑文本框。输入不可拆分结果确认保留完整文本框。

## 自检

- 规格覆盖：任务 1 覆盖解析与复制顺序；任务 2 覆盖卡片交互及样式；任务 3 覆盖生成结果区、编辑和草稿保持；任务 4 覆盖测试、构建和手动验收。
- 占位符检查：计划不含 TBD、TODO 或未定义实现步骤。
- 接口一致性：任务 1 的 `getShotCards` 和 `joinShotCards` 在任务 3 使用；任务 2 的 `ShotOutputCards` 接收任务 3 提供的选择与复制回调。
