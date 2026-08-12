# 全平台主题可读性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一战晟铭用户端、管理端与小说面板工作台在深色、浅色主题下的页面和浮层都清晰可读，同时保留已有布局与模块视觉风格。

**Architecture:** 使用随 `dark`/`light` 状态变化的 Ant Design token 作为基础主题；用户端、管理端和水货生产分别通过 `body` 标记为 portal 浮层提供受限主题边界。小说面板保留既有主题消息协议，只将工作台中的硬编码表面和文字替换为语义变量。先以静态契约测试锁定边界，再进行双主题浏览器回归。

**Tech Stack:** React 18, Ant Design 5, Vite, CSS variables, Node `node:test`, Express iframe workbench, in-app Browser.

---

## 文件结构

- `frontend/src/shared/styles/theme.js`: 按主题模式返回 Ant Design token。
- `frontend/src/user/main.jsx`、`frontend/src/admin/main.jsx`: 不再持有静态主题提供者。
- `frontend/src/shared/layouts/UserLayout.jsx`、`frontend/src/shared/layouts/AdminLayout.jsx`: 以当前 `theme` 提供动态 token 与 portal body 标记。
- `frontend/src/shared/styles/global.css`: 普通用户端、管理端页面内和 portal 的可读性规则。
- `frontend/src/user/pages/ShuihuoProductionPage.jsx`、`frontend/src/user/pages/shuihuo-production.css`: 制作台页面与 portal 状态的可读性规则。
- `public/novel-panel/workbench/style.css`: iframe 工作台的变量化颜色。
- `tests/theme-readability-contract.test.js`: 主题可读性静态契约。

### Task 1: 新增失败的主题可读性契约

**Files:**
- Create: `tests/theme-readability-contract.test.js`
- Test: `tests/theme-readability-contract.test.js`

- [ ] **Step 1: 编写失败测试**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Ant Design theme provides readable dark and light tokens', () => {
  const source = read('frontend/src/shared/styles/theme.js');
  assert.match(source, /export function createAntTheme\(mode\)/);
  for (const token of ['colorTextSecondary', 'colorTextPlaceholder', 'colorBgElevated', 'colorBgContainerDisabled']) {
    assert.ok(source.includes(token), `${token} is required`);
  }
});

test('user and admin portal themes cover every floating surface', () => {
  const css = read('frontend/src/shared/styles/global.css');
  for (const marker of ['.user-theme-active', '.admin-theme-active']) {
    for (const selector of ['.ant-modal-content', '.ant-drawer-content', '.ant-select-dropdown', '.ant-popover-inner', '.ant-message-notice-content', '.ant-notification-notice', '.ant-tooltip-inner']) {
      assert.ok(css.includes(`${marker} ${selector}`), `${marker} must style ${selector}`);
    }
  }
});

test('shuihuo and novel workbench use semantic readable surfaces', () => {
  const shuihuo = read('frontend/src/user/pages/shuihuo-production.css');
  for (const selector of ['.ant-alert', '.ant-table', '.ant-tag', '.ant-empty-description', '.ant-message-notice-content', '.ant-notification-notice', '.ant-tooltip-inner', '.ant-btn:disabled']) {
    assert.ok(shuihuo.includes(`.shuihuo-theme-active ${selector}`), `shuihuo must style ${selector}`);
  }
  const workbench = read('public/novel-panel/workbench/style.css');
  for (const selector of ['.modal-card', '.large-textarea', '.compact-textarea', '.btn.secondary', '.instruction-center-page']) {
    const block = workbench.slice(workbench.indexOf(selector), workbench.indexOf('}', workbench.indexOf(selector)) + 1);
    assert.match(block, /var\(--(ink|muted|surface|surface-soft|field|line|primary)/, `${selector} must use a theme token`);
  }
});
```

- [ ] **Step 2: 确认测试因缺失行为失败**

Run: `node --test tests/theme-readability-contract.test.js`

Expected: FAIL，报告 `createAntTheme(mode)` 及缺失的 portal 或水货生产状态选择器。

- [ ] **Step 3: 检查测试自身语法**

Run: `node --check tests/theme-readability-contract.test.js`

Expected: exit code `0`。

### Task 2: 让 Ant Design token 跟随平台主题

**Files:**
- Modify: `frontend/src/shared/styles/theme.js`
- Modify: `frontend/src/user/main.jsx`
- Modify: `frontend/src/admin/main.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Test: `tests/theme-readability-contract.test.js`

- [ ] **Step 1: 扩充失败测试，锁定动态 ConfigProvider**

```js
test('layouts provide Ant Design with the current platform theme', () => {
  for (const file of ['frontend/src/shared/layouts/UserLayout.jsx', 'frontend/src/shared/layouts/AdminLayout.jsx']) {
    const source = read(file);
    assert.match(source, /createAntTheme\(theme\)/);
    assert.match(source, /<ConfigProvider theme=\{createAntTheme\(theme\)\}>/);
    assert.match(source, /return \(\) => document\.body\.classList\.remove/);
  }
  assert.doesNotMatch(read('frontend/src/user/main.jsx'), /<ConfigProvider/);
  assert.doesNotMatch(read('frontend/src/admin/main.jsx'), /<ConfigProvider/);
});
```

- [ ] **Step 2: 运行新增测试并确认失败**

Run: `node --test tests/theme-readability-contract.test.js`

Expected: FAIL，布局未提供 `createAntTheme(theme)`，入口仍使用静态 provider。

- [ ] **Step 3: 实现按模式返回的 token 工厂**

将 `frontend/src/shared/styles/theme.js` 改为：

```js
const common = {
  colorPrimary: '#f07167',
  borderRadius: 8,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
};

const dark = {
  colorText: '#e8e8f0', colorTextSecondary: '#b8b8c8', colorTextTertiary: '#8b8ba0', colorTextPlaceholder: '#9ea0b2',
  colorBgBase: '#0a0a14', colorBgContainer: '#171726', colorBgElevated: '#1e1e36', colorBgLayout: '#0a0a14',
  colorBgContainerDisabled: '#2a2a3d', colorBorder: 'rgba(255, 255, 255, 0.14)', colorBorderSecondary: 'rgba(255, 255, 255, 0.1)', colorTextDisabled: 'rgba(232, 232, 240, 0.5)'
};

const light = {
  colorText: '#202330', colorTextSecondary: '#536074', colorTextTertiary: '#667085', colorTextPlaceholder: '#667085',
  colorBgBase: '#f4f6fa', colorBgContainer: '#ffffff', colorBgElevated: '#ffffff', colorBgLayout: '#f4f6fa',
  colorBgContainerDisabled: '#edf1f6', colorBorder: '#cfd5e1', colorBorderSecondary: '#e4e7ee', colorTextDisabled: '#7a8494'
};

export function createAntTheme(mode) {
  return { token: { ...common, ...(mode === 'light' ? light : dark) } };
}
```

- [ ] **Step 4: 将动态 provider 放进拥有主题状态的布局**

在两个布局分别导入：

```js
import { ConfigProvider } from 'antd';
import { createAntTheme } from '../styles/theme';
```

将各自原有最终 JSX 包裹为：

```jsx
return <ConfigProvider theme={createAntTheme(theme)}>{layout}</ConfigProvider>;
```

其中 `layout` 是原来的首页/用户 shell 或管理 shell，不能移动 `StackyPet`、登录层或 `children`。从两个 `main.jsx` 删除 `ConfigProvider` 与静态 `theme` import，仅保留 `React.StrictMode` 和根 App。

- [ ] **Step 5: 验证动态 token 实现**

Run: `node --test tests/theme-readability-contract.test.js && npm --prefix frontend run build`

Expected: 主题契约通过，Vite build exit code `0`。

- [ ] **Step 6: 选择性提交任务文件**

Run:

```bash
git add frontend/src/shared/styles/theme.js frontend/src/user/main.jsx frontend/src/admin/main.jsx frontend/src/shared/layouts/UserLayout.jsx frontend/src/shared/layouts/AdminLayout.jsx tests/theme-readability-contract.test.js
git commit -m "fix: make Ant Design theme follow platform mode"
```

Expected: 只提交上述六个文件；不得暂存工作区中已有的无关修改。

### Task 3: 修复用户端与管理端的 portal 和状态控件

**Files:**
- Modify: `frontend/src/shared/styles/global.css`
- Test: `tests/theme-readability-contract.test.js`

- [ ] **Step 1: 增加失败断言，要求两端覆盖状态组件**

在 portal 测试中加入：

```js
for (const marker of ['.user-theme-active', '.admin-theme-active']) {
  for (const selector of ['.ant-alert', '.ant-alert-message', '.ant-alert-description', '.ant-table-thead > tr > th', '.ant-table-tbody > tr > td', '.ant-tag', '.ant-empty-description', '.ant-btn:disabled']) {
    assert.ok(css.includes(`${marker} ${selector}`), `${marker} must style ${selector}`);
  }
}
```

- [ ] **Step 2: 运行并确认缺失状态覆盖**

Run: `node --test tests/theme-readability-contract.test.js`

Expected: FAIL，报告 user/admin message、notification、tooltip、alert、table 或 disabled button 的缺失选择器。

- [ ] **Step 3: 为用户端补齐可读的页面和浮层规则**

在 `.user-theme-active` 规则后加入：

```css
.user-theme-active .ant-message-notice-content, .user-theme-active .ant-notification-notice, .user-theme-active .ant-tooltip-inner { color: var(--legacy-text); border: 1px solid var(--legacy-border-strong); background: var(--legacy-card); }
.user-theme-active .ant-tooltip-arrow::before { background: var(--legacy-card); }
.user-theme-active .ant-alert { color: var(--legacy-text); border-color: var(--legacy-border-strong); background: var(--legacy-card-hover); }
.user-theme-active .ant-alert-message, .user-theme-active .ant-alert-description, .user-theme-active .ant-empty-description { color: var(--legacy-text); }
.user-theme-active .ant-table-thead > tr > th, .user-theme-active .ant-table-tbody > tr > td { color: var(--legacy-text); border-color: var(--legacy-border); background: var(--legacy-card); }
.user-theme-active .ant-tag { color: var(--legacy-text); border-color: var(--legacy-border-strong); }
.user-theme-active .ant-btn:disabled { color: var(--legacy-dim); border-color: var(--legacy-border); background: var(--legacy-card-hover); opacity: 1; }
```

同时为 `.ant-input::placeholder` 与 `.ant-select-selection-placeholder` 添加 `var(--legacy-muted)`，但不覆盖 `.script-chat-textarea` 的专属样式。

- [ ] **Step 4: 为管理端补齐等价规则**

在 `.admin-theme-active` portal 规则后加入：

```css
.admin-theme-active .ant-message-notice-content, .admin-theme-active .ant-notification-notice, .admin-theme-active .ant-tooltip-inner { color: var(--admin-text); border: 1px solid var(--admin-border); background: var(--admin-panel); }
.admin-theme-active .ant-tooltip-arrow::before { background: var(--admin-panel); }
.admin-theme-active .ant-alert-message, .admin-theme-active .ant-alert-description, .admin-theme-active .ant-empty-description { color: var(--admin-text); }
.admin-theme-active .ant-table-thead > tr > th { color: var(--admin-muted); border-color: var(--admin-border); background: var(--admin-table-heading); }
.admin-theme-active .ant-table-tbody > tr > td { color: var(--admin-text); border-color: var(--admin-border); background: var(--admin-panel); }
.admin-theme-active .ant-tag { border-color: var(--admin-border-strong); }
.admin-theme-active .ant-btn:disabled { color: var(--admin-faint); border-color: var(--admin-border); background: var(--admin-panel-hover); opacity: 1; }
```

保持管理端蓝色 primary button 和现有布局不变。

- [ ] **Step 5: 验证并提交用户/管理端 CSS**

Run: `node --test tests/theme-readability-contract.test.js && npm --prefix frontend run build`

Expected: 主题契约通过，Vite build exit code `0`。

Run:

```bash
git add frontend/src/shared/styles/global.css tests/theme-readability-contract.test.js
git commit -m "fix: keep platform portals readable across themes"
```

### Task 4: 完成水货生产的页面和浮层可读性

**Files:**
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/theme-readability-contract.test.js`

- [ ] **Step 1: 运行 Task 1 的水货生产断言并确认失败**

Run: `node --test tests/theme-readability-contract.test.js`

Expected: FAIL，现有制作台只覆盖 modal/input/select/popover，缺少 Alert、table、tag、empty、message、notification、tooltip 与禁用态。

- [ ] **Step 2: 在制作台 CSS 添加可读性规则**

```css
.shuihuo-theme-active .ant-alert, .shuihuo-theme-active .ant-message-notice-content, .shuihuo-theme-active .ant-notification-notice, .shuihuo-theme-active .ant-tooltip-inner { color: var(--sh-text); border-color: var(--sh-line); background: var(--sh-panel-strong); }
.shuihuo-theme-active .ant-alert-message, .shuihuo-theme-active .ant-alert-description, .shuihuo-theme-active .ant-empty-description { color: var(--sh-text); }
.shuihuo-theme-active .ant-tooltip-arrow::before { background: var(--sh-panel-strong); }
.shuihuo-theme-active .ant-table, .shuihuo-theme-active .ant-table-thead > tr > th, .shuihuo-theme-active .ant-table-tbody > tr > td { color: var(--sh-text); border-color: var(--sh-line); background: var(--sh-panel); }
.shuihuo-theme-active .ant-table-thead > tr > th { color: var(--sh-muted); background: var(--sh-panel-strong); }
.shuihuo-theme-active .ant-tag { color: var(--sh-text); border-color: var(--sh-line); background: var(--sh-panel-strong); }
.shuihuo-theme-active .ant-btn:disabled { color: var(--sh-muted); border-color: var(--sh-line); background: var(--sh-panel-strong); opacity: 1; }
```

将深色 `.shuihuo-production` 的 `--sh-muted` 设为 `#aebcba`，与 body portal 层一致；浅色值保留 `#657470`。确认组件包含并清理：

```js
useEffect(() => {
  document.body.classList.add('shuihuo-theme-active');
  return () => document.body.classList.remove('shuihuo-theme-active');
}, []);
```

- [ ] **Step 3: 验证并提交制作台主题修复**

Run: `node --test tests/theme-readability-contract.test.js && npm --prefix frontend run build`

Expected: 主题契约通过，Vite build exit code `0`。

Run:

```bash
git add frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css tests/theme-readability-contract.test.js
git commit -m "fix: make shuihuo production states readable"
```

### Task 5: 将小说面板 iframe 的遗留颜色变量化

**Files:**
- Modify: `public/novel-panel/workbench/style.css`
- Test: `tests/theme-readability-contract.test.js`
- Test: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 运行工作台契约并确认失败**

Run: `node --test tests/theme-readability-contract.test.js`

Expected: FAIL，`.status-pill`、`.btn.secondary`、输入控件或 instruction center 仍有硬编码浅色背景或蓝灰文字。

- [ ] **Step 2: 定义并使用工作台语义变量**

在 `:root` 和 `[data-theme='light']` 各定义：`--field-readonly`、`--status-info`、`--status-info-soft`、`--button-secondary-hover`。以下节点的颜色必须改为 `var(--ink)`、`var(--muted)`、`var(--surface)`、`var(--surface-soft)`、`var(--field)`、`var(--line)` 或上述新增变量：

`.status-pill`、`.inline-field span`、`.btn.secondary`、`.btn.danger-outline`、`.icon-btn`、`.large-textarea`、`.compact-textarea`、`input, select`、`label`、`.tts-status`、`.lock-state`、`.field-note`、`.person-check`、`.empty-state`、`.modal-card`、`.project-row`、`.output-group`、`.count-badge`、`.relationship-graph-panel`、`.relationship-row`、`.instruction-center-page`、`.instruction-center-topbar`、`.instruction-center-sidebar`、`.instruction-center-editor-panel`、`.instruction-nav-button`、`.protocol-lock-card`、`.instruction-ai-helper`、`.instruction-preview-card`。

最低替换基线：

```css
.btn.secondary { color: var(--ink); border-color: var(--line); background: var(--surface-soft); }
.large-textarea, .compact-textarea, input, select { color: var(--ink); border-color: var(--line); background: var(--field); }
label, .inline-field span { color: var(--muted); }
.modal-card { color: var(--ink); border-color: var(--line); background: var(--surface); }
```

保留排版、圆角、间距、交互动效、iframe sandbox 和 `qiantie-theme-sync` 协议。删除统一覆盖层中重复的硬编码来源，确保属性仅由变量层或必要局部特例控制。

- [ ] **Step 3: 运行工作台和资源契约**

Run: `node --test tests/theme-readability-contract.test.js tests/novel-panel-asset-contract.test.js`

Expected: 两个测试文件通过。

- [ ] **Step 4: 选择性提交 iframe 工作台修复**

Run: `git add public/novel-panel/workbench/style.css tests/theme-readability-contract.test.js && git commit -m "fix: make novel workbench theme colors semantic"`

### Task 6: 双主题浏览器回归和最终验证

**Files:**
- Test: `tests/theme-readability-contract.test.js`
- Verify: 已登录 in-app Browser 会话

- [ ] **Step 1: 运行完整静态验证**

Run: `node --test tests/theme-readability-contract.test.js tests/governance-routes.test.js tests/novel-panel-asset-contract.test.js tests/shuihuo-gateway.test.js && npm --prefix frontend run build && git diff --check`

Expected: 所有指定测试通过，Vite build exit code `0`，`git diff --check` 无输出。

- [ ] **Step 2: 审计用户端的深色与浅色状态**

在已登录浏览器逐页访问 `/`、`/script`、`/novel-panel`、`/agent`、`/history`、`/tts`、`/settings`、`/shuihuo-production`。每页检查正文、辅助文字、input/placeholder、正常与禁用按钮、Alert、Empty；有入口时打开 modal、select、popconfirm、dropdown、drawer 或 message。逐页切换深浅主题，并记录无法因权限、空数据或未配置模型触发的状态。

- [ ] **Step 3: 审计管理端的深色与浅色状态**

逐页访问 `/admin`、`/admin/accounts`、`/admin/presets`、`/admin/agent-skills`、`/admin/shuihuo-models`。检查 table、tag、alert、drawer、modal、select、popconfirm 和 message。权限不足时记录实际限制，不绕过鉴权制造结果。

- [ ] **Step 4: 审计小说 iframe 的实时主题同步**

在 `/novel-panel` 中切换主题但不刷新 iframe，检查 iframe 根元素 `data-theme` 与主站一致；检查输入、卡片、模态框、状态提示。读取一个正文、辅助文字、placeholder、dialog 和 disabled button 的 `color` 与 `backgroundColor`，拒绝同色或浅色主题灰白字、深色主题深灰字的组合。

- [ ] **Step 5: 最终选择性提交并报告未覆盖状态**

Run: `git status --short`，人工确认暂存列表仅包含本计划的主题文件后，执行：

```bash
git add frontend/src/shared/styles/theme.js frontend/src/user/main.jsx frontend/src/admin/main.jsx frontend/src/shared/layouts/UserLayout.jsx frontend/src/shared/layouts/AdminLayout.jsx frontend/src/shared/styles/global.css frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo-production.css public/novel-panel/workbench/style.css tests/theme-readability-contract.test.js
git commit -m "fix: keep platform UI readable across themes"
```

保留工作区中其他用户已有修改。最终报告已验证页面、未触发状态和任何剩余风险。
