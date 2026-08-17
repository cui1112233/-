# 小说面板主按钮渐变样式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 将小说面板的主操作按钮升级为可访问、支持主题的紫蓝渐变样式，同时保持次要与危险操作的视觉语义和全部业务逻辑不变。

**Architecture:** 仅在工作台的现有 `.btn` CSS 体系内扩展 `.btn.primary` 的默认、悬停、按下和焦点状态。现有 HTML 中的 `primary` class 已覆盖生成、保存、复制等主操作，因此不修改标记或 JavaScript。通过小说面板资源合约测试锁定主按钮关键样式、减少动态效果规则和非主按钮语义。

**Tech Stack:** 原生 CSS 自定义属性、Node.js 内置测试框架（`node:test`）、Express 静态资源。

## Global Constraints

- 不改变小说面板布局、业务逻辑、接口、存储结构或主题同步 bridge。
- 不更改按钮 HTML、按钮文本、ID、`data-*` 属性或 JavaScript 监听器。
- 不新增第三方依赖。
- 不将 Uiverse 的 CSS 注释写入工作台源码。
- 不修改独立 V77 EXE；仅修改一战晟铭小说面板静态资源。
- `.btn.secondary` 保持轻量描边语义；`.btn.danger`、`.btn.danger-outline` 保持危险操作语义。
- 不提交 Git 提交，除非用户明确要求。

---

## 文件结构

- 修改 `public/novel-panel/workbench/style.css`：仅定义 `.btn.primary` 的渐变、交互状态、键盘焦点与减少动态效果规则；保留其他按钮选择器。
- 修改 `tests/novel-panel-asset-contract.test.js`：通过读取工作台 CSS 的静态合约，验证主按钮使用主题令牌、动画保护与其他按钮语义保持存在。

### Task 1: 为主按钮样式建立资源合约

**Files:**
- Modify: `tests/novel-panel-asset-contract.test.js`
- Verify: `public/novel-panel/workbench/style.css:128-138`

**Interfaces:**
- Consumes: 工作台 CSS 选择器 `.btn.primary`、`.btn.secondary`、`.btn.danger`、`.btn.danger-outline`。
- Produces: 静态资源合约，防止未来替换时丢失渐变、键盘焦点、减少动态效果或危险按钮语义。

- [ ] **Step 1: 在现有资源合约测试文件中增加失败测试**

在测试文件中加入一个 `node:test` 用例，读取 `style.css`，并通过已有的 `lastExactSelectorRuleBlock` 与 `cssDeclarations` 工具验证规则。

```javascript
test('novel-panel primary buttons use the gradient interaction contract without replacing secondary or danger semantics', () => {
  const css = fs.readFileSync(path.join(workbenchRoot, 'style.css'), 'utf8');
  const primary = cssDeclarations(lastExactSelectorRuleBlock(css, '.btn.primary'));
  const focus = cssDeclarations(lastExactSelectorRuleBlock(css, '.btn.primary:focus-visible'));
  const secondary = cssDeclarations(lastExactSelectorRuleBlock(css, '.btn.secondary'));
  const danger = cssDeclarations(lastExactSelectorRuleBlock(css, '.btn.danger'));

  assert.match(primary.get('background'), /linear-gradient\(/);
  assert.equal(primary.get('background-size'), '200% 200%');
  assert.equal(primary.get('border-radius'), '30px');
  assert.match(primary.get('animation'), /button-shimmer/);
  assert.match(focus.get('box-shadow'), /var\(--focus-ring\)/);
  assert.equal(secondary.get('background'), 'var(--surface)');
  assert.equal(danger.get('background'), 'var(--danger-soft)');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.btn\.primary[\s\S]*?animation:\s*none/s);
});
```

- [ ] **Step 2: 运行单个资源合约测试，确认当前实现失败**

Run:

```powershell
node --test tests/novel-panel-asset-contract.test.js
```

Expected: FAIL，提示 `.btn.primary` 尚未定义渐变背景、30px 圆角或减少动态效果规则。

- [ ] **Step 3: 保留测试断言范围在视觉契约内**

确认测试只检查 `.btn.primary` 的视觉和可访问性规则，以及 `.btn.secondary`、`.btn.danger` 的现有语义声明；不对具体按钮文案、HTML 层级或动画持续时间写死。

- [ ] **Step 4: 暂不执行全量测试或提交**

等待 Task 2 CSS 实现后再运行同一测试验证通过；不在此任务创建提交。

### Task 2: 实现主题适配的主按钮渐变与交互状态

**Files:**
- Modify: `public/novel-panel/workbench/style.css:128-138`
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: 已有 `--primary`、`--primary-dark`、`--surface`、`--focus-ring` 主题令牌，以及 HTML 内现有 `.btn.primary` class。
- Produces: `.btn.primary` 的渐变外观、`hover`、`active`、`focus-visible`、`@keyframes button-shimmer` 和减少动态效果覆盖。

- [ ] **Step 1: 更新通用按钮过渡属性**

将 `.btn` 的 transition 扩展为包含阴影和背景位置，同时保留现有紧凑尺寸、边框、文字粗细和默认 9px 圆角：

```css
.btn {
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 9px;
  font-weight: 800;
  transition: transform .2s ease-in-out, background .2s ease-in-out, background-position .45s ease-in-out, border-color .15s ease, box-shadow .2s ease-in-out;
  white-space: nowrap;
}
```

- [ ] **Step 2: 用渐变主按钮规则替换现有 `.btn.primary` 和 hover 规则**

用下面规则替换现有的 `.btn.primary` 与 `.btn.primary:hover:not(:disabled)` 两个规则。令牌表达式确保浅色与深色主题都由当前 CSS 令牌提供颜色：

```css
.btn.primary {
  color: var(--surface);
  border-color: transparent;
  border-radius: 30px;
  background: linear-gradient(135deg, var(--primary-dark), var(--primary));
  background-size: 200% 200%;
  box-shadow: 0 5px 15px rgba(0, 0, 0, .2);
  animation: button-shimmer 2s ease-in-out infinite alternate;
}
.btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--primary-dark), var(--primary));
  background-position: 100% 100%;
  box-shadow: 0 8px 20px rgba(0, 0, 0, .24);
  transform: translateY(-2px);
}
.btn.primary:active:not(:disabled) {
  transform: scale(.95);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .3);
}
.btn.primary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring), 0 5px 15px rgba(0, 0, 0, .2);
}
@keyframes button-shimmer {
  from { background-position: 0% 0%; }
  to { background-position: 100% 100%; }
}
```

- [ ] **Step 3: 增加减少动态效果保护**

在现有移动端媒体查询之后追加下列规则：

```css
@media (prefers-reduced-motion: reduce) {
  .btn,
  .btn.primary {
    animation: none;
    transition: none;
  }
}
```

- [ ] **Step 4: 确认次要、危险和图标按钮规则未改动**

保留 `.btn.secondary`、`.btn.danger`、`.btn.danger-outline`、`.icon-btn` 的原始背景和颜色声明，确保低风险与危险操作不使用主按钮渐变。

- [ ] **Step 5: 运行小说面板资源合约测试并确认通过**

Run:

```powershell
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS，包含新的主按钮样式合约和已有小说面板资源测试。

- [ ] **Step 6: 执行 CSS 静态检查和变更检查**

Run:

```powershell
git diff --check
git diff -- public/novel-panel/workbench/style.css tests/novel-panel-asset-contract.test.js
```

Expected: `git diff --check` 无输出；差异仅包含主按钮 CSS 和资源合约测试。

- [ ] **Step 7: 不提交 Git 提交**

按全局约束，不执行 `git commit`。向用户报告已修改文件、测试命令和结果。
