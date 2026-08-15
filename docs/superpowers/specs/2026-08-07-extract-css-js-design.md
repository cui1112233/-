# CSS/JS 独立化重构设计

## 目标
将项目所有 HTML 页面中的内联 CSS 和 JS 提取为独立文件，统一引用路径，收紧 CSP 策略。

## 现状
- 根 `index.html`：最新版代码，但 ~1650 行 CSS 和 ~1530 行 JS 全部内联
- `views/` 下页面已引用外部文件，但 `public/` 中的 CSS/JS 是旧版，与根 HTML 不同步
- `server.js` CSP 允许 `'unsafe-inline'`

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `public/css/style.css` | 覆盖 | 用根 index.html 内联 CSS 替换（全部公共样式） |
| `public/css/tts.css` | 新建 | 从 views/tts.html 提取 TTS 页专用 CSS |
| `public/js/common.js` | 覆盖 | authFetch + 主题 + 导航 + ApiConfig + 设置UI + Toast + 登录（加空值防御） |
| `public/js/script.js` | 覆盖 | PromptTemplates + AIClient + Extraction + 编辑 + History + ScriptGenerator + 面板拖拽 + 时长/模式切换 + 工具栏 |
| `public/js/tts.js` | 新建 | 从 views/tts.html 提取 TTS 页专用 JS |
| 根 `index.html` | 修改 | 移除 `<style>` 和 `<script>`，替换为 `<link>` 和 `<script src>` |
| `views/tts.html` | 修改 | 移除内联 `<style>` 和 `<script>`，替换为外部引用 |
| `server.js` | 修改 | CSP 中移除 `'unsafe-inline'` |

## 页面引用清单

| 页面 | CSS | JS |
|------|-----|-----|
| `index.html` | `/css/style.css` | `/js/common.js` + `/js/script.js` |
| `views/script.html` | `/css/style.css` | `/js/common.js` + `/js/script.js` |
| `views/agent.html` | `/css/style.css` | `/js/common.js` |
| `views/tts.html` | `/css/style.css` + `/css/tts.css` | `/js/common.js` + `/js/tts.js` |

## 防御策略
common.js 中所有模块对 DOM 元素做空值检查（如 `if (!element) return;`），确保在缺少特定 HTML 结构（如登录遮罩、历史记录下拉）的页面不报错。
