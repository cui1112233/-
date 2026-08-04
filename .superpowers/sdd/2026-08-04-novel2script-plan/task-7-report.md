# Task 7 Report — 剧本生成与输出模块

**日期**: 2026-08-04  
**状态**: ✅ 完成

---

## 完成内容

在 `index.html` 的 `<script>` 标签末尾追加了 3 个 JS 模块：

### 1. ScriptGenerator 模块
- 维护当前格式 `currentFormat`（默认 `shortdrama`）、当前输出 `currentOutput`、当前原文 `currentNovelText`
- `generate(novelText, format)`：调用 `Extraction.getData()` 获取人物/场景，拼接 `PromptTemplates.scriptPrompt()`，通过 `AIClient.callStream()` 流式生成剧本，实时追加到输出区
- `renderOutput(text)`：清空并渲染完整文本到输出区
- `appendToOutput(chunk)`：流式追加文本块，自动清除空状态占位，滚动到底部
- `markOutputComplete()`：确保输出区有内容
- `showActionButtons()` / `hideActionButtons()`：控制底部操作按钮显隐

### 2. 格式切换模块
- 监听 `#format-tabs .format-tab` 的点击事件
- **已修复**：选择器从 `.tab` 修正为 `.format-tab`，与 HTML 实际 class 名一致
- 切换 tab 的 `.active` 样式，并调用 `ScriptGenerator.setCurrentFormat()`

### 3. 复制和导出模块
- **复制**：优先使用 `navigator.clipboard.writeText()`，失败时回退到 `execCommand('copy')`
- **导出**：根据当前格式名生成文件名，使用 `Blob` + `URL.createObjectURL` 触发下载 `.txt` 文件
- 操作后均显示 toast 提示

---

## 关键修正

- 格式切换：`'.tab'` → `'.format-tab'`（与 HTML 中 `class="format-tab"` 匹配）

## 涉及文件

- `f:\脚本测试\qiantie\index.html`：追加 135 行 JS 代码