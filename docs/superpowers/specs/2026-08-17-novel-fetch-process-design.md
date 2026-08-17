# 小说获取页 AI 处理功能设计（诱导排查 / 爆款优化）

## 目标

在「小说获取」页面（`NovelFetchPage`）的结果列表中新增 AI 处理能力：用户对已获取成功的一本或多本小说，可单选或批量选择后，通过后端调用 AI 对正文做处理。首期支持两种处理类型：

- **诱导排查**：对小说原文做合规检测与柔化（去敏），输出合规检测报告 + 优化后全文。
- **爆款优化**：对小说正文做爆款化优化（开篇钩子、节奏、卡点、爽点密度），输出优化说明 + 优化后全文。

两种处理类型的提示词均存放在新增的「小说获取」（`novel-fetch`）预设模块中，可在管理后台维护，后续可继续扩展处理类型。

## 架构总览

```
NovelFetchPage.jsx（前端）
  │  选中已成功书籍 → POST /api/novel-fetch/process { mode, items }
  ▼
routes/novel-fetch.js（后端，工厂可注入 processWithAI）
  │  读取 novel-fetch 预设 body（诱导排查/爆款优化）
  │  readConfig → ensureReadyConfig → requestUpstream（复用模型配置）
  ▼
上游 chat/completions（每本并发）
  ▼
{ results: [{ bookId, status, text, report, error }] }
  → 前端弹窗展示优化后全文，支持复制/单下载/全下载
```

## 一、后端接口

### 新增 `POST /api/novel-fetch/process`

在现有 [routes/novel-fetch.js](file:///f:/脚本测试/chengming/qiantie/routes/novel-fetch.js) 中扩展工厂：

- `createNovelFetchRouter({ fetchUpstream, auth, presetStore, processWithAI })`
- `processWithAI(username, systemPrompt, novelText)` → `Promise<string>`，默认实现：`readConfig(username)` → `ensureReadyConfig` → `requestUpstream` 发送 chat/completions（`system=systemPrompt`，`user=novelText`），返回 AI 文本内容。
- 挂载 `POST /process`，沿用 `apiAuth`。

### 请求体

```json
{
  "mode": "induce",   // "induce" 诱导排查 | "hook" 爆款优化
  "items": [
    { "bookId": "7673480334440139800", "text": "获取到的正文…" }
  ]
}
```

校验：

- `mode` 必须为 `induce` 或 `hook`；
- `items` 非空数组，每项 `bookId` 为 1–20 位数字字符串，`text` 非空；`items` 上限 50；
- 单本文本截断上限 `120000` 字符（与剧本 `novelText` 上限一致）。

### 预设读取

从 `presetStore.getPublished(id)` 读取已发布预设：

- `induce` → `novel-fetch-induce`
- `hook` → `novel-fetch-hook`

预设必须满足 `module === 'novel-fetch'` 且 `protocolLock.format === 'novel-fetch-process'` 且 `protocolLock.operation` 与 mode 匹配；缺失时报“未发布该处理预设”。

### 响应

```json
{
  "results": [
    { "bookId": "…", "status": "ok", "text": "优化后全文", "report": "合规检测报告/优化说明", "error": null },
    { "bookId": "…", "status": "error", "text": null, "report": null, "error": "单本失败原因" }
  ]
}
```

- 每本独立处理、互不影响；按请求顺序返回。
- 单本 AI 失败（网络、超时、非 JSON、上游错误）→ 该书 `status: 'error'`，`error` 为可读原因，其余继续。

## 二、前端交互（NovelFetchPage.jsx）

### 结果列表工具栏

在现有「全选 / 批量复制 / 批量下载」之后新增：

- **处理类型下拉**：选项为「诱导排查」「爆款优化」，从 `GET /api/presets?module=novel-fetch` 的已发布预设动态生成（`protocolLock.format === 'novel-fetch-process'`）；无可用预设时下拉禁用并提示。
- **「AI 处理」按钮**：对**选中**的已成功书籍批量处理。处理中每行状态显示「处理中…」，按钮 loading；全部完成后弹窗展示结果。

### 每行操作

已成功行新增 **「诱导排查」按钮**（单本处理，使用当前下拉选中的处理类型），处理中显示 loading。

### 结果弹窗

- 每本一个分区：处理类型标题 + 报告（诱导排查的合规检测报告 / 爆款优化的优化说明）+ 优化后全文（只读 `Input.TextArea`）。
- 按钮：**复制本本**（`navigator.clipboard`，失败回退 `execCommand`）、**下载本本**（`{bookId}.txt`）。
- 弹窗底部 **全选下载**：逐个触发选中下载；**关闭**。
- 处理结果存入行状态 `induced: { mode, report, text } | null`；已处理的行再次点按直接展示结果，不重复请求。重试失败的书籍需重新请求。

### 数据流

选中 → `POST /api/novel-fetch/process { mode, items }` → 逐本结果 → 行状态记录 + 弹窗展示。

## 三、预设与提示词

### 管理后台

[PresetLibraryPage.jsx](file:///f:/脚本测试/chengming/qiantie/frontend/src/admin/pages/PresetLibraryPage.jsx) 的 `modules` 数组新增：

```js
{ label: '小说获取', value: 'novel-fetch' }
```

### 系统种子

[lib/system-preset-catalog.js](file:///f:/脚本测试/chengming/qiantie/lib/system-preset-catalog.js) 的 `seedSystemPresets` 新增两条已发布预设（`module: 'novel-fetch'`）：

- `novel-fetch-induce`（诱导排查）——正文为用户提供的《小说内容合规检测与柔化优化提示词》全文。
- `novel-fetch-hook`（爆款优化）——正文为本文档第「爆款优化提示词」节撰写的提示词。

两者 `protocolLock: { format: 'novel-fetch-process', operation: 'induce' | 'hook' }`。

### 诱导排查提示词（用户提供）

诱导排查预设正文 = 用户提供的《小说内容合规检测与柔化优化提示词》全文，逐字写入种子预设。其核心要求：最小改动、谐音优先、擦边柔化、分级处理（一级谐音替换 / 二级委婉改写 / 三级重构删除），输出合规检测报告 + 优化后全文 + 关键修改说明。

### 爆款优化提示词（本文档撰写）

```
# 小说爆款优化提示词

## 角色设定
你是一名资深短剧/网文爆款策划与文本优化师，精通下沉市场
短视频平台和网络文学的高留存叙事手法。你的核心职责是：在
**最大程度保留原文剧情、人物设定、叙事风格和核心情节**的
前提下，对小说原文做爆款化优化，让开头更抓人、节奏更紧凑、
卡点更清晰、情绪与爽点更密集，同时保持全文自然流畅、可直
接阅读和后续制作使用。

## 核心工作原则
1. **忠实原文**：禁止改变人物关系、核心动机、剧情走向和结局；
   禁止凭空新增关键角色、关键道具或剧情结果。
2. **开头抓人**：把最强烈的情绪冲突、信息悬念或身份反差前置到
   开头三句以内，快速建立“非看不可”的期待。
3. **节奏紧凑**：删减冗长的环境铺陈和无关细节，缩短铺垫，
   加快事件推进；对话尽量短促有力，一句顶三句。
4. **卡点清晰**：自然段结尾或事件转折处制造悬念、反转或情绪
   峰值，便于后续拆分为短视频单元。
5. **爽点密集**：强化打脸、反转、反差、身份揭露、误会引爆等
   高能节点，保留人物个性与台词口吻，不写成机械模板。

## 优化方向（按需执行）
- 开篇：3 秒内给出冲突/悬念/反差钩子，并自然衔接原文起点。
- 段落：合并碎句、精简描写，每段承载一个明确信息或情绪。
- 对话：精炼台词，突出人物性格，避免冗余客套。
- 情绪：放大可见的情绪张力（表情、动作、语气），让读者“上瘾”。
- 结尾：每段制造小型卡点，为持续阅读和分镜制作留足抓手。

## 输出格式要求
### 一、优化说明
用 2-4 句话说明本次优化的核心手段（如：开头钩子前置、压缩
铺垫、加强卡点、强化打脸节点），以及主要改动位置。

### 二、优化后全文
直接输出完整优化后的小说文本，无需标注修改处，确保流畅可读、
可直接复制使用。

## 执行指令
现在，请接收用户上传的小说原文，按以上规则进行爆款化优化。
务必保证改动后读起来自然、节奏明快、情绪饱满，最大程度还原
原作人物口吻与叙事逻辑。
```

## 四、测试

- `tests/novel-fetch-process-routes.test.js`：注入假 `processWithAI`，覆盖 mode 校验、items 校验、逐本独立结果、预设缺失、文本截断、`presetStore.getPublished` 过滤条件。
- `tests/novel-fetch-process-ui-contract.test.js`：读取源码 + 正则断言——页面含处理类型下拉（诱导排查/爆款优化）、单本与批量处理按钮、结果弹窗、复制/单下载/全下载、预设读取（`/api/presets?module=novel-fetch`）。
- 生产构建通过：`npm --prefix frontend run build`。
- 契约测试沿用现有 `node --test tests/` 执行。

## 不在范围内

- 不实现处理历史持久化、书单/收藏。
- 不改动剧本生成、小说面板、TTS 等既有功能。
- 不接入真实书籍元信息。
- 不修改上游 `txt.121w.com` 抓取逻辑本身。
