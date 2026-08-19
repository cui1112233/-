# 剧本原文输入框清空按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为剧本原文 textarea 增加直接清空的 `×` 按钮，同时确保只有开始新的提取时才重置旧的人物、场景和剧本结果。

**Architecture:** `ScriptPage` 使用 `Form.useWatch('novelText', form)` 派生是否显示清空按钮。点击清空仅设置表单字段并调用 `persistDraft`；`onValuesChange` 保留原文变更时的请求失效和宠物上下文同步，但不再删除已存在结果。`handleExtract` 在通过表单校验、开始新的请求后集中重置旧提取结果和剧本输出。

**Tech Stack:** React 18、Ant Design Form/Input/Button、Lucide React、Node.js built-in test runner、Vite、现有全局 CSS。

## Global Constraints

- 原文有内容时显示 `×`，为空时不显示。
- 点击清空不显示确认框，只清空 `novelText` 及对应草稿字段。
- 清空或编辑原文不得重置人物、场景、提取阶段、剧本结果、卡片选择或配音状态。
- 只有点击“提取”并开始新提取时，才清除旧人物、场景和剧本结果。
- 原文为空时必须保持现有表单必填校验，不能开始提取。
- 清空按钮位于 textarea 右上角，不遮挡内容或滚动条，并带中文无障碍标签。
- 不改动上传 TXT、配音或提取 API。
- 验证通过后仅提交本功能涉及的文件。

---

### Task 1: 原文清空按钮与提取前结果重置

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `tests/script-shot-output-ui-contract.test.js`

**Interfaces:**
- Consumes: `form`, `persistDraft(values)`, `invalidateRequests()`, `syncPetContext(novelText)`, `normalizeExtractInfo()` and existing `handleExtract(values)`.
- Produces: a source-clear button with `aria-label="清空小说原文"`, visible only when the watched `novelText` is non-empty.

- [ ] **Step 1: 先扩展页面契约测试**

在 `tests/script-shot-output-ui-contract.test.js` 新增测试：

```js
test('script source textarea clears without deleting prior results until extraction starts', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const styles = read('frontend/src/shared/styles/global.css');
  assert.match(page, /Form\.useWatch\('novelText', form\)/);
  assert.match(page, /aria-label="清空小说原文"/);
  assert.match(page, /form\.setFieldValue\('novelText', ''\)/);
  assert.match(page, /persistDraft\(\{ \.\.\.form\.getFieldsValue\(\), novelText: '' \}\)/);
  assert.match(page, /function handleExtract\(values\)[\s\S]*?setExtractInfo\(normalizeExtractInfo\(\)\)[\s\S]*?setOutput\(''\)/);
  const sourceChange = page.match(/if \(Object\.hasOwn\(changed, 'novelText'\)\) \{([\s\S]*?)\n        \}/)?.[1] || '';
  assert.doesNotMatch(sourceChange, /setExtractInfo\(normalizeExtractInfo\(\)\)/);
  assert.doesNotMatch(sourceChange, /setOutput\(''\)/);
  assert.match(styles, /script-source-input/);
  assert.match(styles, /script-source-clear/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-shot-output-ui-contract.test.js`

Expected: FAIL，因为当前页面没有 `novelText` watch、清空按钮或提取前重置逻辑。

- [ ] **Step 3: 增加原文 watch 和清空函数**

在 `ScriptPage` 的现有 `Form.useWatch` 声明旁增加：

```js
const novelText = Form.useWatch('novelText', form) || '';
```

新增清空函数：

```js
function clearNovelText() {
  form.setFieldValue('novelText', '');
  persistDraft({ ...form.getFieldsValue(), novelText: '' });
}
```

该函数不得调用 `invalidateRequests`、`syncPetContext`、`setExtractInfo`、`setOutput`、`setGenerationStage`、`setSelectedShotIndexes`、`setNarrating` 或任何配音清理函数。

- [ ] **Step 4: 调整原文变更与提取流程**

在 `onValuesChange` 的 `novelText` 分支中保留：

```js
invalidateRequests();
setExtracting(false);
setGenerating(false);
setRegeneratingEntities(false);
setRegeneratingOutput(false);
setNarrating(false);
syncPetContext(changed.novelText);
```

删除该分支中所有 `setExtractInfo(normalizeExtractInfo())`、`setGenerationStage('idle')`、`setOutput('')` 调用，编辑与粘贴原文时必须保留旧结果。

在 `handleExtract(values)` 的 `beginRequest('workflow')` 后、`setExtracting(true)` 前增加：

```js
setExtractInfo(normalizeExtractInfo());
setOutput('');
setSelectedShotIndexes(new Set());
setEditingOutput(false);
```

不得在这里清除 `sourceAudioUrl` 或调用 `replaceSourceAudio('')`，配音状态应保留。然后保持既有的 `setExtracting(true)`、`setGenerationStage('extracting')`、请求与错误处理流程。

- [ ] **Step 5: 在 textarea 右上角渲染按钮**

用以下结构替换现有仅包含 `Form.Item` 的原文输入区域：

```jsx
<div className="script-source-input">
  <Form.Item name="novelText" rules={[{ required: true, message: '请先粘贴小说原文' }]}>
    <Input.TextArea className="script-chat-textarea" rows={10} placeholder="粘贴小说原文，开始构思... ✦" />
  </Form.Item>
  {novelText ? (
    <button
      type="button"
      className="script-source-clear"
      aria-label="清空小说原文"
      title="清空小说原文"
      onClick={clearNovelText}
    >×</button>
  ) : null}
</div>
```

不得改变 `Form.Item` 的 `name`、规则、textarea placeholder、rows 或现有工具栏结构。

- [ ] **Step 6: 增加最小样式**

在 `global.css` 的 `.script-chat-shell .ant-form-item` 和 `.script-chat-textarea` 相邻区域增加：

```css
.script-source-input {
  position: relative;
}

.script-source-clear {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 1;
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(243, 246, 253, 0.82);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.script-source-clear:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

[data-theme='light'] .script-source-clear {
  background: rgba(26, 43, 72, 0.1);
  color: var(--legacy-muted);
}
```

为 textarea 的右侧预留按钮空间，将现有 padding 改为：

```css
padding: 14px 48px 8px 14px !important;
```

- [ ] **Step 7: 验证实现**

Run:

```powershell
node --test tests/script-shot-output-ui-contract.test.js tests/script-shot-replace.test.js tests/script-shot-output.test.js tests/shot-text-highlight.test.js
npm --prefix frontend run build
git diff --check
```

Expected:
- 所有 Node 测试通过。
- Vite 构建退出码为 0；既有大 chunk 警告可以存在。
- `git diff --check` 无空白错误。

- [ ] **Step 8: 提交**

```powershell
git add -- frontend/src/user/pages/ScriptPage.jsx frontend/src/shared/styles/global.css tests/script-shot-output-ui-contract.test.js
git commit -m "feat: add source input clear button"
```

## Self-Review

- 清空、编辑原文和点击提取的结果重置时机分离，满足“清空不删结果，提取才删结果”。
- 原文为空时仍使用既有 Form required 规则，未引入绕过入口。
- 清空函数只更新原文和草稿，没有触碰请求、宠物、提取、剧本、选择和配音状态。
- 范围限制在页面、现有全局样式和页面契约测试，未增加依赖或修改接口。
