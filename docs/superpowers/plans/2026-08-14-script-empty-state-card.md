# 剧本空状态光效卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 将剧本页空状态改造成跟随系统深浅主题的响应式光效引导卡片。

**Architecture:** 在 `ScriptPage.jsx` 的空状态节点内添加纯装饰子元素和标题，保持现有的空状态条件与说明文案不变。通过 `global.css` 的 `.script-empty` 专属规则实现外层光边、移动光点、射线和装饰线，并复用已有 legacy 主题变量与浅色主题覆写。

**Tech Stack:** React、Lucide React、CSS 自定义属性、Node.js 内置测试运行器。

## Global Constraints

- 仅影响 `!output && !generating` 时的剧本空状态。
- 保留既有图标和“先提取人物与场景，确认后再生成剧本”说明。
- 装饰节点必须带 `aria-hidden="true"`。
- 空状态卡片宽度为 `min(100%, 420px)`，最小高度为 `220px`。
- `prefers-reduced-motion: reduce` 必须禁用光点动画。
- 不修改剧本生成逻辑、数据状态、接口或主题存储。

---

## 文件结构

- 修改 `frontend/src/user/pages/ScriptPage.jsx:546-558`：为空状态加入标题和装饰 DOM。
- 修改 `frontend/src/shared/styles/global.css:1203-1219,1977-1982`：实现主题自适应光效卡片。
- 创建 `tests/script-empty-state-card-contract.test.js`：锁定 JSX 结构、主题 CSS 与可访问性合约。

### Task 1: 锁定空状态卡片结构合约

**Files:**
- Create: `tests/script-empty-state-card-contract.test.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx:546-558`

**Interfaces:**
- Consumes: `ScrollText`、`output`、`generating` 现有空状态条件。
- Produces: `.script-empty-card`、`.script-empty-dot`、`.script-empty-ray`、`.script-empty-line`、`.script-empty-title` 和 `.script-empty-copy`。

- [ ] **Step 1: 写入失败测试**

创建测试文件，读取 `ScriptPage.jsx`，断言空状态使用目标结构并保留文案：

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'),
  'utf8'
);

test('script empty state exposes themed light-card structure', () => {
  assert.match(source, /className="script-empty legacy-panel-card"/);
  assert.match(source, /className="script-empty-card"/);
  assert.match(source, /className="script-empty-dot" aria-hidden="true"/);
  assert.match(source, /className="script-empty-ray" aria-hidden="true"/);
  assert.match(source, /className="script-empty-line script-empty-line--top" aria-hidden="true"/);
  assert.match(source, /className="script-empty-title">准备创作</);
  assert.match(source, /className="script-empty-copy">先提取人物与场景，确认后再生成剧本</);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/script-empty-state-card-contract.test.js
```

Expected: FAIL，因为空状态尚未包含 `.script-empty-card`、装饰节点和标题。

- [ ] **Step 3: 最小化修改 JSX**

将空状态内容改为：

```jsx
<div className="script-empty legacy-panel-card">
  <div className="script-empty-card">
    <span className="script-empty-dot" aria-hidden="true" />
    <span className="script-empty-ray" aria-hidden="true" />
    <span className="script-empty-line script-empty-line--top" aria-hidden="true" />
    <span className="script-empty-line script-empty-line--bottom" aria-hidden="true" />
    <span className="script-empty-line script-empty-line--left" aria-hidden="true" />
    <span className="script-empty-line script-empty-line--right" aria-hidden="true" />
    <div className="script-empty-icon"><ScrollText size={30} strokeWidth={1.6} aria-hidden="true" /></div>
    <div className="script-empty-title">准备创作</div>
    <div className="script-empty-copy">先提取人物与场景，确认后再生成剧本</div>
  </div>
</div>
```

保留原条件 `!output && !generating` 不变。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/script-empty-state-card-contract.test.js
```

Expected: PASS。

### Task 2: 实现主题自适应光效样式

**Files:**
- Modify: `frontend/src/shared/styles/global.css:1203-1219,1977-1982`
- Modify: `tests/script-empty-state-card-contract.test.js`

**Interfaces:**
- Consumes: `.script-empty-card` 和装饰 class。
- Produces: 深色黑灰光效、浅色主题蓝光效、响应式布局和减少动态效果支持。

- [ ] **Step 1: 扩展失败测试**

在测试中读取 `global.css`，增加以下断言：

```javascript
const css = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'shared', 'styles', 'global.css'),
  'utf8'
);

assert.match(css, /\.script-empty\s*\{[^}]*width:\s*min\(100%,\s*420px\)/s);
assert.match(css, /\.script-empty\s*\{[^}]*min-height:\s*220px/s);
assert.match(css, /@keyframes\s+script-empty-move-dot/);
assert.match(css, /\.script-empty-dot\s*\{[^}]*animation:\s*script-empty-move-dot/s);
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.script-empty-dot\s*\{[^}]*animation:\s*none/s);
assert.match(css, /\.theme-light[\s\S]*?\.script-empty-card/s);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/script-empty-state-card-contract.test.js
```

Expected: FAIL，因为光效卡片 CSS 与减少动态效果规则尚不存在。

- [ ] **Step 3: 添加基础、深色与浅色样式**

在全局样式中用 `.script-empty` 覆盖旧的虚线空状态外观，添加 `.script-empty-card`、`.script-empty-dot`、`.script-empty-ray`、`.script-empty-line` 和 `@keyframes script-empty-move-dot`。

必须满足：

```css
.script-empty {
  width: min(100%, 420px);
  min-height: 220px;
  margin: 0 auto;
  padding: 1px;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
}

.script-empty-card {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 218px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--legacy-border);
  border-radius: 11px;
}

.script-empty-dot {
  position: absolute;
  z-index: 2;
  width: 5px;
  aspect-ratio: 1;
  border-radius: 50%;
  animation: script-empty-move-dot 6s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .script-empty-dot { animation: none; }
}
```

深色默认规则使用黑灰径向渐变、白色光点与白色柔光。浅色主题选择器（以项目现有 `.theme-light` 约定为准）覆盖为浅蓝灰径向渐变、主题蓝光点、低对比蓝紫射线及深色文字。不要改动全局主题变量。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/script-empty-state-card-contract.test.js
```

Expected: PASS。

### Task 3: 回归验证剧本页

**Files:**
- Modify: 无
- Test: `tests/script-empty-state-card-contract.test.js`, `tests/cm-agent-ui-contract.test.js`, `tests/theme-readability-contract.test.js`

**Interfaces:**
- Consumes: Tasks 1-2 的 JSX 和 CSS。
- Produces: 可访问、主题自适应且不影响现有剧本页契约的空状态卡片。

- [ ] **Step 1: 运行空状态卡片测试**

Run:

```bash
node --test tests/script-empty-state-card-contract.test.js
```

Expected: PASS。

- [ ] **Step 2: 运行剧本页相关契约测试**

Run:

```bash
node --test tests/cm-agent-ui-contract.test.js tests/theme-readability-contract.test.js
```

Expected: PASS；若存在本次变更前已存在的独立失败，记录其测试名和失败原因。

- [ ] **Step 3: 构建 React 前端**

Run:

```bash
npm --prefix frontend run build
```

Expected: Vite 构建完成，退出码 0。

- [ ] **Step 4: 手动验收**

在浏览器打开 `/script`，确保未生成剧本时出现“准备创作”卡片。切换主软件浅色与深色主题，确认卡片颜色同步且 320px 宽度下无横向溢出。系统开启减少动态效果后，确认光点停止沿边缘移动。
