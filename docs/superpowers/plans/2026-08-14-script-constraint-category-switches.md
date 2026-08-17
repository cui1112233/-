# 剧本约束分类开关与预设可见 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为剧本约束设置增加四个独立分类开关、只读系统预设提示词与仅追加的台词添加词。

**Architecture:** 前端草稿中的每个约束分类增加 `enabled` 状态并按开关延迟显示配置区；系统预设正文从已发布目录读取并只读呈现。后端以总开关、分类开关和格式白名单决定注入，再将服务端预设正文和用户 `customText` 依次组合，绝不让用户文本覆盖系统预设。

**Tech Stack:** React 18、Ant Design、Node.js、Express、node:test、本地 localStorage 草稿、服务端系统预设目录。

## Global Constraints

- 适用画布模式、剧情模式、分镜模式；`shortdrama`（剧本模式）继续禁用约束并由后端强制忽略。
- 总开关开启后四个分类默认仍关闭；关闭分类不显示配置也不得注入该分类内容。
- 分类仅为 `prefix`、`quality`、`restriction`、`negative`。
- 系统预设正文只能展示为只读文本，必须从已发布约束预设目录获取，不能由浏览器提交为可信正文。
- `customText` 保持字段名以兼容草稿/API，但 UI 名称为“台词添加词”；它只追加到有效系统预设正文之后，不能覆盖系统预设。
- 旧草稿中有 `presetId` 或非空 `customText` 但没有分类 `enabled` 的分类，归一化后必须为 `enabled: true`。
- 运行 `node --test tests/script-constraints.test.js tests/script-chat.test.js tests/shuihuo-production-ui-contract.test.js` 与 `npm run frontend:build`。

---

## 文件结构

- Modify: `frontend/src/user/pages/scriptConstraints.js` — 默认状态、旧草稿迁移归一化、格式过滤。
- Modify: `frontend/src/user/pages/ScriptPage.jsx` — 分类开关、条件配置区、只读预设正文、台词添加词文案。
- Modify: `routes/chat.js` — 分类文本的服务端有效性检查和“预设正文 + 添加词”组合。
- Modify: `tests/script-constraints.test.js` — 状态默认值、迁移和格式过滤断言。
- Modify: `tests/script-chat.test.js` — 组装顺序、分类开关、无效预设与 `shortdrama` 断言。
- Modify: `tests/script-ui-contract.test.js` or existing `tests/script-generation-ui-contract.test.js` — 约束弹窗结构与只读预设展示的静态契约断言。

### Task 1: 分类开关状态与旧草稿迁移

**Files:**
- Modify: `frontend/src/user/pages/scriptConstraints.js`
- Modify: `tests/script-constraints.test.js`

**Interfaces:**
- Produces `DEFAULT_SCRIPT_CONSTRAINTS` where each category is `{ enabled: false, presetId: '', customText: '' }`.
- Produces `normalizeScriptConstraints(value)` that always returns four valid categories and preserves old active selections.
- Consumes existing `constraintsForFormat(constraints, format)`; it must retain per-category state except `shortdrama` returns disabled constraints.

- [ ] **Step 1: 写旧草稿迁移失败测试**

在 `tests/script-constraints.test.js` 添加：

```js
test('normalizes legacy populated categories as enabled', () => {
  const constraints = normalizeScriptConstraints({
    enabled: true,
    prefix: { presetId: 'script-constraint-prefix-2d', customText: '' },
    quality: { presetId: '', customText: '电影级光影' }
  });
  assert.equal(constraints.prefix.enabled, true);
  assert.equal(constraints.quality.enabled, true);
  assert.equal(constraints.restriction.enabled, false);
  assert.equal(constraints.negative.enabled, false);
});

test('defaults new categories to disabled', () => {
  const constraints = normalizeScriptConstraints({ enabled: true });
  assert.equal(constraints.prefix.enabled, false);
  assert.equal(constraints.prefix.presetId, '');
  assert.equal(constraints.prefix.customText, '');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-constraints.test.js`

Expected: FAIL，因为当前分类对象不含 `enabled`。

- [ ] **Step 3: 实现最小归一化规则**

在 `scriptConstraints.js` 定义：

```js
const CONSTRAINT_CATEGORIES = ['prefix', 'quality', 'restriction', 'negative'];

function normalizeCategory(value) {
  const presetId = String(value?.presetId || '');
  const customText = String(value?.customText || '');
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : Boolean(presetId || customText.trim()),
    presetId,
    customText
  };
}
```

`DEFAULT_SCRIPT_CONSTRAINTS` 的四类都使用 `enabled: false`。`normalizeScriptConstraints` 对四个分类均调用 `normalizeCategory`；不改变总开关的既有默认和格式过滤行为。

- [ ] **Step 4: 运行归一化测试确认通过**

Run: `node --test tests/script-constraints.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/user/pages/scriptConstraints.js tests/script-constraints.test.js
git commit -m "feat: add per-category script constraint state"
```

### Task 2: 服务端追加式约束组装

**Files:**
- Modify: `routes/chat.js`
- Modify: `tests/script-chat.test.js`

**Interfaces:**
- Produces `resolveConstraintText(presetStore, category, value)` returning the newline combination of a valid published constraint preset body followed by `customText`.
- A category contributes only when `value.enabled === true`.
- `buildConstraintWrapper(presetStore, constraints, format)` maintains existing `{ before, after }` interface and existing section order.

- [ ] **Step 1: 写分类开关和追加顺序失败测试**

在 `tests/script-chat.test.js` 使用已有 mock preset store 添加：

```js
test('appends dialogue additions after the enabled system constraint preset', () => {
  const messages = buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试',
    constraints: {
      enabled: true,
      prefix: { enabled: true, presetId: 'script-constraint-prefix-2d', customText: '少女向暖色校园' },
      quality: { enabled: false, presetId: '', customText: '' },
      restriction: { enabled: false, presetId: '', customText: '' },
      negative: { enabled: false, presetId: '', customText: '' }
    }
  }, presetStore);
  const prompt = messages[0].content;
  assert.match(prompt, /高质量二维动画[\s\S]*?少女向暖色校园/);
});

test('does not inject a category whose independent switch is off', () => {
  const messages = buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试',
    constraints: { enabled: true, prefix: { enabled: false, presetId: 'script-constraint-prefix-2d', customText: '不可注入' } }
  }, presetStore);
  assert.doesNotMatch(messages[0].content, /高质量二维动画|不可注入/);
});
```

测试中补齐其它类别为空对象，以符合现有请求结构。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-chat.test.js`

Expected: FAIL，因为当前实现会让 `customText` 覆盖系统正文，也不检查分类开关。

- [ ] **Step 3: 实现分类启用与文本合并**

将 `resolveConstraintText` 改为：

```js
function resolveConstraintText(presetStore, category, value) {
  if (value?.enabled !== true) return '';
  const parts = [];
  const presetId = String(value?.presetId || '');
  const prefix = CONSTRAINT_CATEGORY_PREFIXES[category];
  if (prefix && presetId.startsWith(prefix)) {
    const preset = constraintPreset(presetStore, presetId);
    if (preset?.kind === 'addon' && preset.protocolLock?.format === 'constraint' && preset.protocolLock?.category === category) {
      const body = String(preset.body || '').trim();
      if (body) parts.push(body);
    }
  }
  const customText = String(value?.customText || '').trim();
  if (customText) parts.push(customText);
  return parts.join('\n');
}
```

保留 `buildConstraintWrapper` 的格式限制、总开关、空标题过滤及 `quality + restriction` 合并规则。

- [ ] **Step 4: 写并验证错误预设与剧本模式回归测试**

增加断言：分类打开、错误类别 presetId、存在添加词时只出现添加词；`format: 'shortdrama'` 时即便全部分类开关打开也不含 `【画面前缀】`、`【画质约束】`、`【负面提示词】`。运行：

Run: `node --test tests/script-chat.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add routes/chat.js tests/script-chat.test.js
git commit -m "fix: append script constraint additions to presets"
```

### Task 3: 分类开关、只读预设正文与台词添加词界面

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-ui-contract.test.js` or existing script UI contract test file

**Interfaces:**
- Consumes `constraintCatalog` objects containing `id`, `name`, `body`, and `constraintCategory`.
- Produces `constraintPresetBody(category, presetId): string` from the loaded catalog only.
- Saves `draftConstraints[category].enabled`, `presetId`, and `customText` using Task 1 normalization.

- [ ] **Step 1: 写失败的 UI 静态契约测试**

在现有剧本 UI contract 文件添加：

```js
test('constraint settings use independent category switches and read-only preset content', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /\['prefix', '画面前缀词'\]/);
  assert.match(page, /checked=\{draftConstraints\[category\]\.enabled\}/);
  assert.match(page, /系统预设提示词（只读）/);
  assert.match(page, /台词添加词/);
  assert.match(page, /constraintPresetBody\(category, draftConstraints\[category\]\.presetId\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-ui-contract.test.js`

Expected: FAIL，因为页面没有分类 `enabled` 开关和只读预设正文。

- [ ] **Step 3: 添加只读预设查找函数**

在 `ScriptPage` 内添加：

```js
function constraintPresetBody(category, presetId) {
  return String(constraintCatalog.find(item => item.constraintCategory === category && item.id === presetId)?.body || '').trim();
}
```

确认预设目录 API 的公开 catalog 数据包含 `body`；如果当前 API 只返回 `id/name/category`，在其安全公开响应中添加已发布 constraint addon 的 `body`，不暴露私有预设、密钥、模型配置或未发布版本。

- [ ] **Step 4: 替换四个始终展开的分类区块**

保留类别数组。对每类先渲染带名称和 Switch 的行：

```jsx
<Switch
  checked={draftConstraints[category].enabled}
  onChange={enabled => setDraftConstraints(current => ({
    ...current,
    [category]: { ...current[category], enabled }
  }))}
/>
```

仅 `draftConstraints[category].enabled` 为真时渲染 Select、只读 `Input.TextArea`（`readOnly`、无 `onChange`）和添加词 `Input.TextArea`。只读区标签固定为“系统预设提示词（只读）”；未选预设时 value 为“尚未选择系统预设”。添加词标签和 placeholder 固定使用“台词添加词（仅追加）”及“此内容会追加在系统预设提示词之后，不会修改系统预设。”。

- [ ] **Step 5: 运行 UI 契约与前端构建**

Run: `node --test tests/script-ui-contract.test.js`

Expected: PASS。

Run: `npm run frontend:build`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/user/pages/ScriptPage.jsx routes/presets.js tests/script-ui-contract.test.js
git commit -m "feat: show enabled script constraints and preset text"
```

### Task 4: 全链路回归验证

**Files:**
- Test: `tests/script-constraints.test.js`
- Test: `tests/script-chat.test.js`
- Test: `tests/script-ui-contract.test.js`

**Interfaces:**
- Validates all production behavior from Task 1–3 without changing production code.

- [ ] **Step 1: 运行针对性自动测试**

Run: `node --test tests/script-constraints.test.js tests/script-chat.test.js tests/script-ui-contract.test.js`

Expected: PASS。

- [ ] **Step 2: 运行前端构建**

Run: `npm run frontend:build`

Expected: PASS；允许既有 bundle size warning，但不得有构建错误。

- [ ] **Step 3: 浏览器验收**

打开“剧本生成”：选择画布模式，打开约束设置与总开关；确认四类各自关闭且无配置区。打开“画面前缀词”，选择“2D 动漫”；确认系统提示词只读显示“高质量二维动画”，填写“少女向暖色校园”后确认只读区不变。保存、生成后检查请求系统提示词中 2D 正文位于添加词之前。关闭画面前缀词后再次生成，确认两段内容均不注入。切换剧本模式，确认入口禁用且生成请求不注入任何约束标题。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/user/pages/scriptConstraints.js frontend/src/user/pages/ScriptPage.jsx routes/chat.js routes tests
git commit -m "test: verify script constraint category switches"
```

## 计划自检

- Task 1 覆盖默认状态与旧草稿迁移。
- Task 2 覆盖后端分类开关、追加式文本、安全预设验证及输出格式不变。
- Task 3 覆盖仅开启后显示、只读预设、台词添加词及安全公开目录。
- Task 4 覆盖自动化、构建与浏览器真实交互验收。
- 不修改全局系统预设正文，不新增模型调用，也不改变 `shortdrama` 的禁用边界。