# 05 批量工厂 · Director Pipeline

## 目标

批量工厂用于一次导入多篇小说开篇，将其批量转为可审核、可编辑、可生成视频的导演方案。它与单篇创作工作台并列，不在导入阶段创建大量完整水货/漫剧项目。

## 两种文本 AI 工作流

### 原文直转

正常路径只调用一次文本 AI：原文理解、人物/场景/道具、剧情拆分、VIDEO 时长、内部镜头和视频提示词在同一导演调用中完成。

AI 可以影视化转译，但不能因为认为某段无效或不重要而删掉进入本次生成范围的原文内容。原文对白可以跨 VIDEO 拆分，但不能漏掉后半句。

### 爆款开头

1. 第一回 AI 只做爆款开头改编。
2. 用户审核、编辑并确认，保存 `approvedHookScript`。
3. 第二回 AI 只对锁定的 `approvedHookScript` 做导演化；原小说只做事实约束。

爆款模式允许把已有情绪外化、放大，例如愤怒可升级为拍桌、摔普通物件、怒骂、身体颤抖等强表演；不得借此新增改变剧情走向的重大事件。

## VIDEO 与 Camera Shot

- 一个 storyboard / 小节 = 一个独立 VIDEO 生成单元。
- 一个 VIDEO 内通常有约 3~5 个 camera shot，不等于一镜到底。
- 镜头数服务于剧情，不作为固定模板。

## 时长协议

### 普通模式

`maxVideoDuration = 10 | 15` 表示单个 VIDEO 的模型时长上限。

例如最大 15 秒时，可以输出：

- VIDEO 01: 13s
- VIDEO 02: 12s
- VIDEO 03: 10s

总时长可以超过 15 秒。

### 固定单镜头

用户界面名称为“固定单镜头”，代码语义为 `fixedSingleVideo` / single video unit。

- 只允许一个 VIDEO。
- 选择 10s 时必须精确输出 10s。
- 选择 15s 时必须精确输出 15s。
- 输入再长也不输出第二个 VIDEO。
- 只消费从原文开头开始、能完整承载的连续范围；不能从对白或完整动作中间截断。
- 剩余内容记录为未生成范围，本次前端不继续展示。

### 时间轴

最终执行时：

- `duration_sec` 必须整数。
- `start_sec/end_sec` 必须整数。
- 第一个镜头从 0 开始。
- 相邻镜头首尾连续。
- 不允许留空、重叠。
- 最后一个 `end_sec === duration_sec`。

提示词中的 2.0~3.0 秒、3.5~4.5 秒仅用于导演判断镜头承载能力，不是最终小数 duration。

## 画幅

批次支持：

- `9:16`
- `16:9`

画幅不仅写入最终 Prompt，也应作为结构化视频模型参数提交。

## 前缀词

### AI 自动

导演在同一回 AI 输出中为每个 VIDEO 选择 `prefix_key`，服务器再解析到当前已发布的视频前缀预设，不单独调用 AI。

V1 key：

- `general_anime`
- `modern_conflict`
- `ancient_drama`
- `xuanhuan_action`
- `suspense`
- `era_drama`

### 用户补充

自动模式可以再追加 `customPrefix`；手动模式只使用 `customPrefix`。

## VideoPromptCompiler

每个 VIDEO 在提交视频模型前重新编译，不能只发送裸 `video_desc`。

编译输入：

- 实际秒数
- 画幅
- 自动前缀 + 用户补充前缀
- 本 VIDEO 人物名称及完整人物 prompt
- 场景名称及完整场景 prompt
- 本 VIDEO 实际道具及完整道具 prompt
- `video_desc`
- 画质约束
- 画面限制
- 负面提示词

编译结果至少包含：

```json
{
  "duration": 13,
  "aspect_ratio": "9:16",
  "prompt": "【视频时长：13秒】..."
}
```

## 数据暂存

导入阶段使用批量工厂 staging 数据，不创建大量完整项目：

```text
OpeningBatch
└─ OpeningItem
   ├─ sourceText
   ├─ hookDraft
   ├─ approvedHookScript
   ├─ hookMeta
   ├─ directorResult
   ├─ promptVersions
   └─ status
```

当前 Node V1 存储到用户目录 `batch-factory.json`。

## 后台预设

`系统预设词 → 批量工厂`：

- 爆款开头改编元提示词
- 原文直转导演元提示词
- 爆款开头导演元提示词
- 人物提示词元提示词
- 场景提示词元提示词
- 视频提示词元提示词
- 视频前缀预设库

沿用现有 draft / published / archived / rollback 版本系统；导演结果记录本次实际使用版本。

## 队列

文本导演阶段在 Node V1 使用服务端有界并发队列，不从浏览器循环发起上百个 AI 请求。默认最大并发 3。

实际视频生成仍应进入现有受控任务队列/模型适配层，而不是让浏览器直连视频提供方。

## 视频生成接入点

Go 视频模型协议已经有 `Prompt`, `Duration`, `AspectRatio` 字段。后续实际生成接入应做到：

1. 用户点击生成视频时才建立/转换为正式项目与 segment，避免导入时污染项目列表。
2. 把 `compiled_prompt` 保存为对应 VIDEO 的视频提示词。
3. 把 `duration`、`aspect_ratio` 写入任务 input snapshot。
4. Worker 从任务快照恢复这两个字段，设置 `models.Request.Duration` 与 `models.Request.AspectRatio`。
5. 具体 Seedance/Vidu/其他模型由各自 adapter 映射供应商参数。

当前 V1 已完成导演与编译层；实际视频供应商提交必须等具体模型适配器和所需参考媒体策略接通后再启用按钮，不能伪装为已生成。
