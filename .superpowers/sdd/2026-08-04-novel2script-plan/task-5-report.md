# Task 5 完成报告：追加 PromptTemplates 模块

## 状态：✅ 已完成

## 所做工作

在 `f:\脚本测试\qiantie\index.html` 的 `<script>` 标签内，Toast 模块之后、AIClient 模块之前，成功追加了 `PromptTemplates` 模块。

### 新增代码

模块 `PromptTemplates` 通过 IIFE 封装，暴露两个方法：

- **`extractPrompt(novelText)`** — 生成人物/场景提取的 system prompt 和 user prompt，返回 OpenAI 格式的消息数组
- **`scriptPrompt(novelText, charsJson, scenesJson, format)`** — 根据格式类型（screenplay/storyboard/shortdrama/all）生成剧本转化的 system prompt 和 user prompt，返回 OpenAI 格式的消息数组

### 文件变更

- `index.html`：在 `<script>` 标签内追加了约 200 行代码（PromptTemplates 模块）