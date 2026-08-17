# 小说面板主题统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 让小说面板在浅色和深色主题中，都以一套统一的语义配色渲染工作台及所有功能子页面。

**Architecture:** 保留宿主通过 bridge 写入 `html[data-theme]` 的机制。在工作台 `style.css` 定义浅色默认令牌和同名深色覆盖令牌，并将所有组件的颜色映射到这些令牌。动态创建的提示节点改用 CSS class，不再由 JavaScript 写入固定颜色。

**Tech Stack:** Node.js、Express 静态资源、原生 CSS 自定义属性、原生 JavaScript。

## Global Constraints

- 不改变小说面板布局、业务逻辑、接口、存储结构或主题同步 bridge。
- `:root` 必须作为未收到主题同步时的浅色默认主题。
- 所有工作台配色必须使用 CSS 自定义属性；不得为共享 UI 语义添加新的硬编码十六进制颜色。
- 不提交 Git 提交，除非用户明确要求。

---

## 文件结构

- 修改 `public/novel-panel/workbench/style.css`：定义双主题令牌，替换基础工作台、关系图、AI 指令中心、历史记录的硬编码配色，并增加动态提示的 class 规则。
- 修改 `public/novel-panel/workbench/app.js`：动态节点仅指定语义 class，不设置颜色、边框或背景内联样式。
- 修改 `tests/novel-panel-asset-contract.test.js`：覆盖深色主题令牌及动态提示 class 合约。

### Task 1: 建立工作台双主题令牌

**Files:**
- Modify: `public/novel-panel/workbench/style.css:1-17`
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: bridge 写入的 `html[data-theme="light"]` 与 `html[data-theme="dark"]`。
- Produces: `--bg`、`--surface`、`--surface-soft`、`--field`、`--field-readonly`、`--ink`、`--muted`、`--line`、`--line-strong`、`--primary`、`--primary-dark`、`--primary-soft`、`--warning`、`--warning-soft`、`--warning-line`、`--shadow`。

- [ ] **Step 1: 编写失败的资源合约测试**

在 `tests/novel-panel-asset-contract.test.js` 增加测试，读取 `style.css` 后断言包含深色主题选择器和关键令牌：

```javascript
assert.match(css, /\[data-theme=['"]dark['"]\]/);
assert.match(css, /--field:/);
assert.match(css, /--field-readonly:/);
assert.match(css, /--line-strong:/);
assert.match(css, /--warning-line:/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: FAIL，提示深色主题选择器或新令牌不存在。

- [ ] **Step 3: 定义浅色默认令牌与深色覆盖**

在 `style.css` 顶部将当前 `:root` 扩展为完整浅色令牌，并紧接着添加 `[data-theme='dark']`，覆盖完全相同的令牌名。深色令牌必须使背景、卡片、输入框、边框、文字、警告和阴影均为深色语义值。

```css
:root {
  --bg: #f5f7fb;
  --surface: #ffffff;
  --surface-soft: #fafbff;
  --field: #ffffff;
  --field-readonly: #f7f9ff;
  --ink: #18233a;
  --muted: #66738b;
  --line: #dce3f0;
  --line-strong: #c7d2e5;
  --primary: #3f5ef7;
  --primary-dark: #2d47d8;
  --primary-soft: #edf1ff;
  --warning: #8a5b00;
  --warning-soft: #fff8e8;
  --warning-line: #e9d092;
  --shadow: 0 16px 44px rgba(31, 50, 93, .09);
}

[data-theme='dark'] {
  --bg: #111827;
  --surface: #1b2536;
  --surface-soft: #202d40;
  --field: #172132;
  --field-readonly: #202c3e;
  --ink: #edf3ff;
  --muted: #aab7cc;
  --line: #33435b;
  --line-strong: #4b5f7e;
  --primary: #8ea5ff;
  --primary-dark: #b4c2ff;
  --primary-soft: #263962;
  --warning: #f1c56d;
  --warning-soft: #3c3019;
  --warning-line: #71551e;
  --shadow: 0 16px 44px rgba(0, 0, 0, .28);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS。

### Task 2: 令牌化基础工作台与关系图

**Files:**
- Modify: `public/novel-panel/workbench/style.css:30-319`
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: Task 1 中定义的主题令牌。
- Produces: 基础表单、按钮、卡片、弹窗、状态消息和人物关系图均依赖主题令牌。

- [ ] **Step 1: 编写失败的资源合约测试**

在测试中断言关键基础组件不再含固定白色背景，并使用语义变量：

```javascript
assert.match(css, /\.btn\.secondary\s*\{[^}]*background:\s*var\(--surface\)/s);
assert.match(css, /\.large-textarea[^}]*background:\s*var\(--field\)/s);
assert.match(css, /\.relationship-graph-panel[^}]*border:\s*1px solid var\(--line\)/s);
assert.doesNotMatch(css, /var\(--border,\s*#d9dee8\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: FAIL，关键组件仍使用固定颜色或旧 `--border` 回退值。

- [ ] **Step 3: 替换基础组件颜色**

将以下选择器中的固定白色、浅灰、蓝灰和黄色映射到 Task 1 的令牌：

- `.status-pill`、`.btn.secondary`、`.btn.danger-outline`、`.icon-btn`
- `.large-textarea`、`.compact-textarea`、`input`、`select`、`.scene-text[readonly]`
- `.character-card`、`.scene-card`、`.output-card`、`.segment-card`、`.person-check`
- `.warning-box`、`.empty-state`、`.modal-card`、`.modal-note`、`.project-row`
- `.output-group`、`.count-badge`、`.mapped-shot-card`、`.prompt-instruction-card`
- `.relationship-graph-panel`、`.relationship-row`、`.pending-relation`

使用 `var(--surface)`、`var(--surface-soft)`、`var(--field)`、`var(--field-readonly)`、`var(--ink)`、`var(--muted)`、`var(--line)`、`var(--line-strong)`、`var(--primary-soft)`、`var(--warning-soft)`、`var(--warning-line)`。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS。

### Task 3: 令牌化 AI 指令中心和历史记录页

**Files:**
- Modify: `public/novel-panel/workbench/style.css:322-388`
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: Task 1 的主题令牌。
- Produces: `.instruction-center-*` 和 `.history-*` 页面在两种主题中保持同一层级语义。

- [ ] **Step 1: 编写失败的资源合约测试**

```javascript
assert.match(css, /\.instruction-center-page\s*\{[^}]*background:\s*var\(--bg\)/s);
assert.match(css, /\.instruction-center-topbar[^}]*background:\s*var\(--surface\)/s);
assert.match(css, /\.history-page\s*\{[^}]*background:\s*var\(--bg\)/s);
assert.match(css, /\.history-record[^}]*background:\s*var\(--surface\)/s);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: FAIL，功能子页面仍使用固定浅色值。

- [ ] **Step 3: 将功能页硬编码颜色替换为令牌**

将 AI 指令中心和历史记录页中的页面背景、顶栏、侧栏、导航按钮、编辑器、协议锁定卡、工具栏、记录卡、辅助文字与阴影映射到 `--bg`、`--surface`、`--surface-soft`、`--field`、`--ink`、`--muted`、`--line`、`--primary`、`--primary-soft`、`--shadow`。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS。

### Task 4: 移除动态硬编码颜色

**Files:**
- Modify: `public/novel-panel/workbench/app.js:9848-9869`
- Modify: `public/novel-panel/workbench/app.js:14428-14445`
- Modify: `public/novel-panel/workbench/app.js:14640-14653`
- Modify: `public/novel-panel/workbench/style.css`
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: `--muted`、`--warning`、`--warning-soft`、`--warning-line`。
- Produces: `.cast-source-tag`、`.v43-character-result-banner`、`.v44-character-isolation-banner` 的主题自适应样式。

- [ ] **Step 1: 编写失败的资源合约测试**

```javascript
const app = fs.readFileSync(path.join(workbenchRoot, 'app.js'), 'utf8');
assert.match(css, /\.cast-source-tag\s*\{[^}]*color:\s*var\(--muted\)/s);
assert.match(css, /\.v43-character-result-banner,[\s\S]*\.v44-character-isolation-banner\s*\{[^}]*background:\s*var\(--warning-soft\)/s);
assert.doesNotMatch(app, /sourceTag\.style\.color\s*=/);
assert.doesNotMatch(app, /banner\.style\.cssText\s*=/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: FAIL，JavaScript 仍设置固定颜色或 `cssText`。

- [ ] **Step 3: 改用 CSS class 表达动态提示语义**

在 `style.css` 添加：

```css
.cast-source-tag { margin-left: 4px; color: var(--muted); }
.v43-character-result-banner,
.v44-character-isolation-banner {
  padding: 10px 12px;
  color: var(--warning);
  border: 1px solid var(--warning-line);
  border-radius: 8px;
  background: var(--warning-soft);
  font-size: 13px;
  line-height: 1.55;
}
.v43-character-result-banner { margin: 0 0 12px; }
.v44-character-isolation-banner { padding: 12px; line-height: 1.65; }
```

在 `app.js` 删除 `sourceTag.style.marginLeft`、`sourceTag.style.color` 和两处 `banner.style.cssText`；保留现有 className 与文字逻辑。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS。

### Task 5: 运行验证并检查服务资源

**Files:**
- Modify: 无
- Test: `tests/novel-panel-asset-contract.test.js`

**Interfaces:**
- Consumes: Tasks 1-4 的主题样式与动态 class。
- Produces: 可运行的主题统一工作台。

- [ ] **Step 1: 检查工作台 JavaScript 语法**

Run:

```bash
node --check public/novel-panel/workbench/app.js
```

Expected: 退出码 0，无输出。

- [ ] **Step 2: 运行小说面板资源合约测试**

Run:

```bash
node --test tests/novel-panel-asset-contract.test.js
```

Expected: PASS。

- [ ] **Step 3: 重启 Express 服务**

Run:

```bash
npm start
```

Expected: 输出 `Server running on (Express)` 且监听 `http://127.0.0.1:3000`。

- [ ] **Step 4: 验证工作台资源可访问**

Run:

```bash
curl.exe -I http://127.0.0.1:3000/novel-panel/workbench/style.css
```

Expected: `HTTP/1.1 200 OK` 且包含 `Cache-Control: private, max-age=0, must-revalidate`。

- [ ] **Step 5: 手动主题验收**

在主软件切换浅色和深色主题；确认小说面板的工作台、AI 指令中心、历史记录、人物关系图、输入框、次级按钮、警告横幅和选角来源标签均同步变化，且没有白底/浅色文字导致的割裂。
