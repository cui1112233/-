# 深色剧本工作台 UI 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复折叠导航图标裁切问题，为用户端提供持久化明暗主题，并统一剧本、历史、配音和设置页面的创作工具视觉层级。

**Architecture:** `UserLayout` 拥有导航折叠与主题选择状态，并将主题同步至根元素的 `data-theme` 和浏览器本地存储。共享 CSS 通过变量定义深色默认值和浅色覆盖值；各页面只增加语义类名，由共享规则保持相同的工具栏、面板、表格与表单风格。

**Tech Stack:** React 18、Ant Design 5、CSS 自定义属性、Express 多页面入口、Node `assert` 静态架构检查。

---

## 文件结构

- 修改：`frontend/src/shared/layouts/UserLayout.jsx`，管理主题、导航折叠和工具栏操作。
- 修改：`frontend/src/shared/styles/global.css`，提供两套主题变量、无裁切导航规则和工作台/工具页视觉规则。
- 修改：`frontend/src/user/pages/ScriptPage.jsx`，增加工作台语义类名，不改变生成和分栏逻辑。
- 修改：`frontend/src/user/pages/HistoryPage.jsx`，增加历史页工具面板语义类名，不改变历史 API 调用。
- 修改：`frontend/src/user/pages/SettingsPage.jsx`，增加设置页工具面板语义类名，不改变配置 API 调用。
- 修改：`frontend/src/user/pages/TtsPage.jsx`，增加配音页工具面板语义类名，不改变语音生成逻辑。
- 修改：`scripts/validate-react-frontend-architecture.js`，检查导航、主题和工作台交互合同。

### Task 1: 写入主题与导航回归合同

**Files:**
- Modify: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 写入会失败的主题与导航断言**

在现有 `userLayout` 断言后加入：

```js
assert(userLayout.includes('THEME_STORAGE_KEY'), 'user layout should persist theme preference');
assert(userLayout.includes('data-theme'), 'user layout should sync theme to the document root');
assert(userLayout.includes('toggleTheme'), 'user layout should provide a theme toggle');
assert(userLayout.includes('legacy-theme-toggle'), 'user layout should render the theme toggle control');
```

在现有 `globalCss` 断言后加入：

```js
assert(globalCss.includes("[data-theme='light']"), 'global CSS should define the light theme overrides');
assert(globalCss.includes('flex: 0 0 32px'), 'collapsed navigation icons should keep a fixed visible hit area');
assert(globalCss.includes('.legacy-sidebar.collapsed .legacy-nav-icon'), 'collapsed navigation icons should have dedicated alignment rules');
```

- [ ] **Step 2: 运行断言，确认其因尚未实现主题而失败**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: 以 `user layout should persist theme preference` 失败。

- [ ] **Step 3: 保留断言作为回归测试**

不要在本任务中修改生产代码；生产实现放到 Task 2，确保本任务先证明测试捕捉到缺失行为。

- [ ] **Step 4: 提交测试合同**

```bash
git add scripts/validate-react-frontend-architecture.js
git commit -m "test: cover workbench theme and navigation contract"
```

### Task 2: 实现共享主题和不裁切导航

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 在 `UserLayout` 初始化并同步主题状态**

在 `navItems` 后定义：

```js
const THEME_STORAGE_KEY = 'yizhan-theme';

function initialTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}
```

把 React 导入替换为：

```js
import { useEffect, useState } from 'react';
```

在状态声明中加入并同步：

```js
const [theme, setTheme] = useState(initialTheme);

useEffect(() => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}, [theme]);

function toggleTheme() {
  setTheme(current => current === 'dark' ? 'light' : 'dark');
}
```

在 `.legacy-userbar` 内、用户名之前插入唯一主题按钮：

```jsx
<button
  className="legacy-theme-toggle"
  type="button"
  aria-label={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
  title={theme === 'dark' ? '切换至浅色主题' : '切换至深色主题'}
  onClick={toggleTheme}
>
  {theme === 'dark' ? '☀' : '☾'}
</button>
```

- [ ] **Step 2: 修复折叠态图标几何关系**

在 `global.css` 中把 `.legacy-nav-icon` 设为固定图标容器：

```css
.legacy-nav-icon {
  width: 32px;
  min-width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
```

把当前页指示线改为绝对定位，避免它占用折叠态横向空间：

```css
.legacy-nav a { position: relative; }
.legacy-nav a.active::before {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
}
.legacy-sidebar.collapsed .legacy-nav { padding: 12px 6px; }
.legacy-sidebar.collapsed .legacy-nav a { gap: 0; padding: 5px; }
.legacy-sidebar.collapsed .legacy-nav-icon { margin: 0 auto; }
```

- [ ] **Step 3: 用变量完整定义浅色主题与工具栏状态**

在默认 `:root` 变量后新增：

```css
[data-theme='light'] {
  --legacy-bg: #f4f6fa;
  --legacy-panel: rgba(255, 255, 255, 0.88);
  --legacy-card: #ffffff;
  --legacy-card-hover: #f5edf0;
  --legacy-input: #ffffff;
  --legacy-border: #e4e7ee;
  --legacy-border-strong: #cfd5e1;
  --legacy-text: #202330;
  --legacy-muted: #667085;
  --legacy-dim: #98a2b3;
  --legacy-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
}
```

为 `.legacy-theme-toggle` 添加 `32px` 方形点击区、边框、悬停和键盘焦点规则；为 `.legacy-topbar`、`.legacy-sidebar`、`.script-tabs`、`.script-toolbar` 使用 `var(--legacy-panel)`，避免深色值硬编码阻断浅色主题。

使用以下规则定义主题切换按钮并替换顶部栏硬编码背景：

```css
.legacy-theme-toggle {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--legacy-border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--legacy-muted);
  cursor: pointer;
}
.legacy-theme-toggle:hover { background: var(--legacy-card-hover); color: var(--legacy-text); }
.legacy-theme-toggle:focus-visible { outline: 2px solid var(--legacy-accent); outline-offset: 2px; }
.legacy-topbar { background: var(--legacy-panel); }
```

- [ ] **Step 4: 运行测试，确认主题与导航合同通过**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: `React frontend architecture validation passed.`

- [ ] **Step 5: 提交共享交互实现**

```bash
git add frontend/src/shared/layouts/UserLayout.jsx frontend/src/shared/styles/global.css scripts/validate-react-frontend-architecture.js
git commit -m "feat: add persistent workbench theme controls"
```

### Task 3: 统一工作台与工具页视觉层级

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/HistoryPage.jsx`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Modify: `frontend/src/user/pages/TtsPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 给页面根节点添加稳定的语义类名**

将 `ScriptPage` 的工作台根节点 class 改为：

```jsx
className="script-workbench utility-workbench"
```

将历史页、设置页最外层 `Space` 改为：

```jsx
<Space className="utility-page history-page" direction="vertical" size={16} style={{ width: '100%' }}>
<Space className="utility-page settings-page" direction="vertical" size={16} style={{ width: '100%', maxWidth: 720 }}>
```

将配音页根节点改为：

```jsx
<div className="tts-workbench utility-workbench">
```

- [ ] **Step 2: 增加共享工具页与控件样式**

在 `global.css` 添加：

```css
.utility-page { padding: 24px; overflow: auto; }
.utility-workbench { background: var(--legacy-bg); }
.legacy-panel-card, .entity-card, .recent-empty { border-radius: 8px; }
.script-tabs, .script-toolbar, .tts-toolbar { background: var(--legacy-panel); }
.script-empty, .tts-empty { border: 1px dashed var(--legacy-border-strong); border-radius: 8px; background: var(--legacy-card); }
```

使用以下限定样式统一 Ant Design 控件；只能引用已有主题变量：

```css
.legacy-shell .ant-btn-default {
  color: var(--legacy-text);
  border-color: var(--legacy-border-strong);
  background: transparent;
}
.legacy-shell .ant-btn-default:hover { color: var(--legacy-accent) !important; border-color: var(--legacy-accent) !important; }
.legacy-shell .ant-segmented { background: var(--legacy-input); }
.legacy-shell .ant-segmented-item { color: var(--legacy-muted); }
.legacy-shell .ant-segmented-item-selected { color: var(--legacy-text); background: var(--legacy-card); }
.legacy-shell .ant-table-wrapper .ant-table { color: var(--legacy-text); background: var(--legacy-card); }
.legacy-shell .ant-table-wrapper .ant-table-thead > tr > th,
.legacy-shell .ant-table-wrapper .ant-table-tbody > tr > td { color: var(--legacy-text); background: var(--legacy-card); border-color: var(--legacy-border); }
.legacy-shell .ant-modal-content { color: var(--legacy-text); background: var(--legacy-card); }
.legacy-shell .ant-slider-rail { background: var(--legacy-border-strong); }
.legacy-shell .ant-slider-track { background: var(--legacy-accent); }
```

- [ ] **Step 3: 扩展静态回归检查**

在 `validate-react-frontend-architecture.js` 加入：

```js
assert(scriptPage.includes('utility-workbench'), 'script page should use the shared workbench surface');
assert(read('frontend/src/user/pages/HistoryPage.jsx').includes('utility-page history-page'), 'history page should use the shared utility page surface');
assert(read('frontend/src/user/pages/SettingsPage.jsx').includes('utility-page settings-page'), 'settings page should use the shared utility page surface');
assert(ttsPage.includes('utility-workbench'), 'TTS page should use the shared workbench surface');
assert(globalCss.includes('.utility-page'), 'global CSS should style utility pages');
assert(globalCss.includes('.legacy-theme-toggle'), 'global CSS should style the theme switcher');
```

- [ ] **Step 4: 运行静态检查与构建**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: `React frontend architecture validation passed.`

Run: `npm --prefix frontend run build`

Expected: 退出码为 `0`；允许 Vite 仅报告现有 bundle size 建议。

- [ ] **Step 5: 提交页面视觉统一改造**

```bash
git add frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/HistoryPage.jsx frontend/src/user/pages/SettingsPage.jsx frontend/src/user/pages/TtsPage.jsx frontend/src/shared/styles/global.css scripts/validate-react-frontend-architecture.js
git commit -m "feat: polish shared workbench surfaces"
```

### Task 4: 浏览器验收与多页面回归

**Files:**
- Test: `scripts/validate-multipage-architecture.js`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 运行多页面架构检查**

Run: `node scripts/validate-multipage-architecture.js`

Expected: `Multipage architecture validation passed.`

- [ ] **Step 2: 在浏览器验证折叠导航**

打开已登录的 `/script`，点击“收起导航”，确认侧栏宽度为 `60px`，五个图标都完整显示；点击“展开导航”，确认宽度恢复 `220px` 且文字可见。

- [ ] **Step 3: 在浏览器验证主题持久化**

点击“切换至浅色主题”，确认 `/script` 的页面、面板、输入控件和文字都可读；刷新后确认按钮变为“切换至深色主题”且浅色主题仍生效。再切回深色主题，确认相同的可读性。

- [ ] **Step 4: 在浏览器验证工作台与工具页**

在 `/script` 从中间分隔条向右拖动至少 120px，确认左侧宽度改变、右侧未低于 460px。访问 `/history`、`/tts`、`/settings`，确认顶部栏、主题按钮、输入控件和文字在两种主题下都可辨识。

- [ ] **Step 5: 记录验收证据并提交最终状态**

Run: `git diff --check`

Expected: 无输出且退出码为 `0`。

仅提交本计划涉及的文件；不要暂存 `index.html`、`public/js/common.js`、`prompts/`、`views/`、`middleware/` 或其他既有未提交内容。
