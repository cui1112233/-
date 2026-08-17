# 剧本生成 CM Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 React 剧本生成请求期间，用 CM SVG 动效替换右侧输出区的空状态。

**Architecture:** `ScriptPage` 复用既有 `loading` 和 `output` 状态，不改变生成 API。`CmLoader` 是页面内部组件，样式使用 `cm-` 前缀以隔离旧页面和 Ant Design 控件。

**Tech Stack:** React 18、SVG、CSS 动画、Node `assert` 检查。

---

### Task 1: 锁定加载状态合同

**Files:**
- Modify: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 在 `scriptPage` 断言后加入**

```js
assert(scriptPage.includes('function CmLoader()'), 'script page should define the CM loader component');
assert(scriptPage.includes('cm-loader'), 'script page should render the CM loader surface');
assert(scriptPage.includes('role="status"'), 'CM loader should announce generation status');
assert(scriptPage.includes('loading ? <CmLoader />'), 'script output should show CM loader while generating');
```

在 `globalCss` 断言后加入：

```js
assert(globalCss.includes('.cm-loader'), 'global CSS should style the CM loader');
assert(globalCss.includes('@keyframes cmDashArray'), 'global CSS should animate CM loader strokes');
assert(globalCss.includes('prefers-reduced-motion: reduce'), 'CM loader should respect reduced motion');
```

- [ ] **Step 2: 确认新增合同失败**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: `script page should define the CM loader component`。

- [ ] **Step 3: 提交回归合同**

Run: `git add scripts/validate-react-frontend-architecture.js && git commit -m "test: cover CM script loader contract"`

### Task 2: 实现 CM 组件与动画

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: 在 `EntitySection` 前添加 `CmLoader`**

```jsx
function CmLoader() {
  return <div className="cm-loader" role="status" aria-live="polite">
    <svg className="cm-loader-defs" aria-hidden="true"><defs>
      <linearGradient id="cm-blue"><stop stopColor="#973bed" /><stop offset="1" stopColor="#007cff" /></linearGradient>
      <linearGradient id="cm-spin"><stop stopColor="#ffc800" /><stop offset="1" stopColor="#ff00ff" /></linearGradient>
      <linearGradient id="cm-green"><stop stopColor="#00e0ed" /><stop offset="1" stopColor="#00da72" /></linearGradient>
    </defs></svg>
    <div className="cm-loader-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64"><path className="cm-loader-dash" pathLength="360" stroke="url(#cm-blue)" strokeWidth="8" d="M54.7 4H60C59 17 49.1 27.7 36.1 29.6V60h-6.5V31.6C16.6 29.7 6.7 17 5.7 4H9.3c1.2 11.6 11 20.6 22.7 20.7C43.8 24.8 53.7 15.7 54.7 4Z" /></svg>
      <svg viewBox="0 0 64 64"><path className="cm-loader-spin" pathLength="360" stroke="url(#cm-spin)" strokeWidth="10" d="M32 32m0-27a27 27 0 1 1 0 54a27 27 0 1 1 0-54" /></svg>
      <svg viewBox="0 0 64 64"><path className="cm-loader-dash" pathLength="360" stroke="url(#cm-green)" strokeWidth="8" d="M4 4h4.6v25.9c0 11.9 9.8 21.6 21.8 21.3c11.6-.2 21-9.6 21.3-21.3V4h4.6v25.9c0 14.3-11.6 25.9-25.9 25.9C16 56.1 4 44.4 4 29.9Z" /></svg>
    </div>
    <strong>正在生成剧本</strong><span>正在提取人物、场景并组织剧情</span>
  </div>;
}
```

- [ ] **Step 2: 将输出区条件替换为三分支**

```jsx
{output ? (
  <Input.TextArea className="legacy-output" value={output} rows={24} readOnly />
) : loading ? <CmLoader /> : (
  <div className="script-empty legacy-panel-card"><div className="script-empty-icon">📄</div><div>粘贴小说内容，点击“提取人物与场景并生成”开始</div></div>
)}
```

- [ ] **Step 3: 将下列 CSS 追加到 `global.css`**

```css
.cm-loader { min-height:260px; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--legacy-text); text-align:center; }
.cm-loader-defs { position:absolute; width:0; height:0; overflow:hidden; }
.cm-loader-mark { display:flex; gap:8px; margin-bottom:8px; }
.cm-loader-mark svg { width:64px; height:64px; fill:none; }
.cm-loader-dash { animation:cmDashArray 2s ease-in-out infinite,cmDashOffset 2s linear infinite; }
.cm-loader-spin { transform-origin:center; animation:cmSpinDashArray 2s ease-in-out infinite,cmSpin 8s ease-in-out infinite,cmDashOffset 2s linear infinite; }
.cm-loader span { color:var(--legacy-muted); font-size:13px; }
@keyframes cmDashArray { 0% { stroke-dasharray:0 1 359 0; } 50% { stroke-dasharray:0 359 1 0; } 100% { stroke-dasharray:359 1 0 0; } }
@keyframes cmSpinDashArray { 0%,100% { stroke-dasharray:270 90; } 50% { stroke-dasharray:0 360; } }
@keyframes cmDashOffset { from { stroke-dashoffset:365; } to { stroke-dashoffset:5; } }
@keyframes cmSpin { 0% { rotate:0deg; } 12.5%,25% { rotate:270deg; } 37.5%,50% { rotate:540deg; } 62.5%,75% { rotate:810deg; } 87.5%,100% { rotate:1080deg; } }
@media (prefers-reduced-motion: reduce) { .cm-loader-dash,.cm-loader-spin { animation:none; } }
```

- [ ] **Step 4: 运行检查与构建**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: `React frontend architecture validation passed.`

Run: `npm --prefix frontend run build`

Expected: 退出码为 `0`；允许 Vite bundle size 建议。

- [ ] **Step 5: 浏览器验证并提交**

在 `/script` 输入文本后启动生成，确认右侧先显示 CM Loader，完成后显示剧本文本或空状态；浅色主题下 SVG 和说明也必须可辨识。

Run: `git add frontend/src/user/pages/ScriptPage.jsx frontend/src/shared/styles/global.css scripts/validate-react-frontend-architecture.js && git commit -m "feat: add CM loader for script generation"`
