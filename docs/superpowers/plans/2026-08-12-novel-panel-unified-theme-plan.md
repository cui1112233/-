# 小说面板统一主题实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小说面板作为“一战晟铭”平台功能，实时继承主站唯一浅色/深色主题。

**Architecture:** `UserLayout` 保持唯一主题状态并传递给 `NovelPanelPage`。页面在 iframe 加载和主题变化时发送仅含 `type`、`theme` 的父窗口主题消息；工作台校验父窗口消息后设置自身 `data-theme`，并由 CSS 语义变量完成视觉变化。

**Tech Stack:** React、Ant Design、原生 iframe `postMessage`、原生 JavaScript、CSS Custom Properties、Node test。

---

## 文件结构

- 修改：`frontend/src/shared/layouts/UserLayout.jsx`，将已持久化的唯一主题值传入当前页面子树。
- 修改：`frontend/src/user/App.jsx`，将主题值传给 `NovelPanelPage`，不影响其他独立 URL 页面。
- 修改：`frontend/src/user/pages/NovelPanelPage.jsx`，在 iframe 加载和主题改变时发送严格主题消息。
- 修改：`public/novel-panel/workbench/bridge.js`，仅接受父页面有效主题消息并应用到工作台根元素。
- 修改：`public/novel-panel/workbench/style.css`，声明深浅色工作台语义令牌，覆盖现有主要表面、文字、输入与弹窗。
- 修改：`tests/novel-panel-asset-contract.test.js`，锁定同步协议和主题安全边界。

### Task 1: 锁定主题同步契约

**Files:**
- Modify: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 写入失败测试**

在 `qiantie navigation renders the V77 workbench in a same-origin iframe` 测试中加入：

```js
assert.match(novelPanelPage, /theme\s*===\s*'light'\s*\?\s*'light'\s*:\s*'dark'/);
assert.match(novelPanelPage, /type:\s*'qiantie-theme-sync'/);
assert.match(novelPanelPage, /onLoad=\{handleFrameLoad\}/);
assert.match(bridge, /event\.source !== window\.parent/);
assert.match(bridge, /data\.type !== 'qiantie-theme-sync'/);
assert.match(bridge, /document\.documentElement\.dataset\.theme = data\.theme/);
assert.doesNotMatch(bridge, /localStorage\.(?:getItem|setItem)\([^\n]*theme/i);
```

并读取 `bridge.js` 和 `style.css`，断言：

```js
assert.match(style, /\[data-theme=['"]light['"]\]/);
assert.match(style, /--bg:/);
assert.match(style, /--surface:/);
```

- [ ] **Step 2: 运行失败测试**

运行：`node --test tests/novel-panel-asset-contract.test.js`

预期：FAIL，缺少 `qiantie-theme-sync` 协议和工作台浅色主题变量。

### Task 2: 由主站唯一主题源同步 iframe

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/user/pages/NovelPanelPage.jsx`

- [ ] **Step 1: 传递已生效主题**

将 `UserLayout` 的渲染内容改为克隆唯一子页面元素并注入 `theme`：

```jsx
const page = isValidElement(children) ? cloneElement(children, { theme }) : children;
```

在首页与非首页布局中渲染 `page`，保持 `THEME_STORAGE_KEY`、`data-theme` 和主题按钮为唯一状态源。

`UserApp` 改为把 `getPage` 产物交给 `UserLayout`，并让 `NovelPanelPage` 接收 `theme` prop；其他页面不需要新增主题状态。

- [ ] **Step 2: 在工作台加载与主题改变时同步**

在 `NovelPanelPage` 增加主题规范化与发送函数：

```js
function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

function postTheme(frame, theme) {
  frame?.contentWindow?.postMessage({
    type: 'qiantie-theme-sync',
    theme: normalizeTheme(theme)
  }, '*');
}
```

工作台 iframe 是 opaque origin，因此主题消息仅可使用 `'*'` 发送；消息对象只能包含 `type` 和规范化后的 `theme`。在依赖 `[theme]` 的 effect 中发送，且在 `handleFrameLoad` 首先发送。保留现有 `MessageChannel`、nonce 握手、API 桥接与 iframe sandbox 属性，不增加 `allow-same-origin`。

- [ ] **Step 3: 运行同步契约测试**

运行：`node --test tests/novel-panel-asset-contract.test.js`

预期：主题同步断言仍失败，只剩工作台接收端与 CSS 未实现的部分。

### Task 3: 让工作台安全接收主题并使用平台语义色

**Files:**
- Modify: `public/novel-panel/workbench/bridge.js`
- Modify: `public/novel-panel/workbench/style.css`

- [ ] **Step 1: 安全接收主题消息**

在 `bridge.js` 现有消息监听器之前添加独立监听器：

```js
window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.type !== 'qiantie-theme-sync') return;
  if (data.theme !== 'dark' && data.theme !== 'light') return;
  document.documentElement.dataset.theme = data.theme;
});
```

该分支不使用 `localStorage`，不读取消息中的任何其他字段。

- [ ] **Step 2: 定义工作台深浅色令牌**

替换工作台 CSS 顶部变量为平台语义色。默认深色，并通过 `[data-theme='light']` 覆盖：

```css
:root {
  --bg: #0a0a14;
  --surface: rgba(30, 30, 54, 0.92);
  --surface-soft: rgba(40, 40, 70, 0.72);
  --ink: #e8e8f0;
  --muted: #8b8ba0;
  --line: rgba(255, 255, 255, 0.12);
  --field: rgba(10, 10, 24, 0.7);
  --primary: #f07167;
}

[data-theme='light'] {
  --bg: #f4f6fa;
  --surface: #ffffff;
  --surface-soft: #ffffff;
  --ink: #202330;
  --muted: #667085;
  --line: #e4e7ee;
  --field: #ffffff;
}
```

追加最小工作台覆盖，把硬编码白色表面、输入框、次级按钮、卡片、模态框和指令中心替换为 `--surface`、`--surface-soft`、`--field`、`--ink`、`--line`；保留布局尺寸、交互和品牌强调色。

- [ ] **Step 3: 运行主题契约测试**

运行：`node --test tests/novel-panel-asset-contract.test.js`

预期：PASS。

### Task 4: 集成验证

**Files:**
- Modify: `tests/novel-panel-asset-contract.test.js`

- [ ] **Step 1: 扩展 bridge 模拟测试**

在现有 bridge 测试的 sandbox window 中触发来自 `window.parent` 的主题消息，并断言：

```js
messageListener({
  source: window.parent,
  data: { type: 'qiantie-theme-sync', theme: 'light' }
});
assert.equal(document.documentElement.dataset.theme, 'light');
```

再传入错误来源和 `theme: 'system'`，断言主题仍为 `light`。

- [ ] **Step 2: 完整回归**

运行：

```bash
node --test tests/*.test.js
node scripts/validate-react-frontend-architecture.js
npm --prefix frontend run build
```

预期：所有 Node 测试通过，架构校验输出 `React frontend architecture validation passed.`，Vite 构建完成。

- [ ] **Step 3: 浏览器验证**

在 `http://127.0.0.1:3000/novel-panel` 登录后：

1. 点击侧栏主题按钮，确认 iframe 内面板、卡片、输入框和弹窗立即改变，不刷新页面。
2. 刷新页面，确认小说面板恢复当前主题。
3. 再切回另一主题，确认主站与小说面板始终一致。

- [ ] **Step 4: 提交边界**

当前工作树含用户未提交变更。不要提交、重置、暂存或格式化任何与本任务无关的文件；仅报告本任务实际修改的文件和验证结果。
