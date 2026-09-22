# Batch Factory V11 新版布局与生产逻辑实施计划

> 日期：2026-09-12
> 目标分支：`v88`
> 实施分支：`feature/v88-bf11-new-layout-implementation-20260912`
> 唯一主设计依据：`批量工厂新版布局与生产逻辑设计总结.md`

## 0. 需求优先级

实施时严格按以下优先级解释冲突：

1. 用户在 2026-09-10～2026-09-12 对“重新设计批量工厂”的后续明确决定。
2. `批量工厂新版布局与生产逻辑设计总结.md`。
3. 当前 v88 已有实现（只作为兼容基础，不反向覆盖产品设计）。
4. 更旧的 Batch Factory 原型/文档。

以下后续决定已经覆盖总结文档里仍标为“未决”的内容：

- `VIDEO01` 是一个完整 VIDEO 单元；内部允许 1 个或多个 Shot。
- 每个 Shot 独立生成一个视频片段；左右箭头切换 Shot；Shot 片段按顺序合成为 VIDEO。
- 默认/目标生成时长为 6 秒；Provider 不支持 6 秒或实际返回 10 秒时保留原始 10 秒，不裁剪。
- 匹配音频同时存在生成阶段约束与合并阶段倍率修正。
- 视频长于音频可加速；音频长于视频允许慢放；允许用户手动调整倍率。
- TTS/计时音频默认只用于测时与节奏，不混入最终成片。
- 原始 Shot/VIDEO 素材必须保留。

## 1. 不做的事情

- 不修改 v78。
- 不继续旧 Prompt Studio / 提示词工作室方向。
- 不把旧自由拖拽/缩放网格当成新版主布局。
- 不把供应商 `@图片N` 等语法写进业务模型。
- 不把画面提示词直接提交给视频模型。
- 不为了满足 6 秒目标裁剪 Provider 实际返回的 10 秒原视频。
- 本轮实现完成前不自动部署公网；先合并 v88 后再单独执行发布验收。

## 2. 当前代码差距

当前 v88 已有 Director 输出的 `shots[]`，但 Shot 仍只是 VIDEO 内的时间轴描述；生产任务、持久化、结果、重试主要还是 VIDEO 粒度。

已确认的关键差距：

1. 缺少一等生产 Shot 数据模型/状态/结果。
2. `final_prompt.go` 仍会把 `visualPrompt` 编入视频 Prompt，违反新版硬规则。
3. 生产路径仍以一次 VIDEO 一次 Provider 调用为主，未做到一 Shot 一生成任务。
4. 当前工作台围绕 `selectedVideoId` 和可拖拽布局，未建立统一 `currentShotIndex`。
5. 资产图与同对象文字 Prompt 仍需统一成“有图不用词”。
6. Shot → VIDEO → Book 的两级合并、失败阶段重试、音频倍率修正仍需按新版规则收口。

## 3. Phase 1 — Shot 成为一等生产实体（P0）

### 3.1 RED tests

先补失败测试，至少覆盖：

- Director 一个 VIDEO 的 `shots[]` 能转换为稳定、有序的生产 Shot。
- Shot 具备稳定 ID、VIDEO 归属、顺序、开始/结束/目标时长、当前资产引用、videoPrompt、visualPrompt、visualImage、videoResult、状态等字段。
- 旧数据没有显式 Shot 生产记录时可安全水合，不串 Book/VIDEO。
- 多 Shot 顺序稳定；单 Shot 同样成立。

### 3.2 实现

优先复用现有 `batchfactoryv11` package 与 MySQL store：

- 扩展 `types.go` / Director output hydration。
- 扩展 store schema/SQL；如需要结构迁移，使用项目现有 Goose 迁移方式。
- API 输出兼容现有 Book/VIDEO，同时增加 Shot 列表。
- 任何 Shot ID 都必须在同一 Book/VIDEO 范围内稳定可追踪。

### 3.3 验收

- `Book → VIDEO → Shot` 成为真实后端结构，而非前端模拟。
- 1 Shot / 2 Shot / 3+ Shot 都可表达。
- 当前 Shot 可以独立记录生成状态和结果。

## 4. Phase 2 — Prompt / 参考图编译与 Provider 输入（P0）

### 4.1 RED tests

必须先证明旧逻辑会失败：

- `visualPrompt` 不得出现在视频 `compiledPrompt`。
- 有画面提示词、无画面图片时，视频生成完全忽略画面提示词。
- 同一资产对象有图时只进入 `referenceImages[]`，不得再注入该对象文字 Prompt。
- 对象无图 + fallback ON 才加入文字 Prompt。
- 对象无图 + fallback OFF 不参与。
- 当前 Shot 未引用的资产不参与。
- 多个相关图片保留为通用 `referenceImages[]`，业务层不写 Provider 专用语法。

### 4.2 实现

拆清两种 Prompt：

- `visualPrompt`：只给图片生成。
- `videoPrompt` / `compiledVideoPrompt`：只给视频生成。

视频输入编译顺序：

1. 当前 Shot 的有效资产引用。
2. 对每个对象执行“有图不用词”。
3. 画面图片（如果已经真实生成）。
4. 当前 Shot 的视频提示词。
5. 匹配音频约束（开启时）。
6. 其他启用的约束。
7. 交给 Provider Adapter 做能力映射。

Provider 不支持所需参考图数量/能力时必须明确报错或采用显式策略，不得静默丢关键输入。

## 5. Phase 3 — Shot 媒体生产、重试与两级合并（P0/P1）

### 5.1 Shot 生成

- 每个 Shot 独立创建 Provider 任务。
- 默认请求目标 6 秒。
- Provider 不支持 6 秒时可使用其可支持值，例如 10 秒。
- Provider 实际返回 10 秒时记录真实时长并保留原文件；不裁剪为 6 秒。

### 5.2 重试

- 可勾选小说。
- 优先只重试失败步骤。
- Shot 视频失败只重试该 Shot；不重新做人像/场景图或成功 Shot。
- VIDEO 合并失败只重做 VIDEO 合并。
- Book 合并失败只重做最终合并。

### 5.3 合并层级

```text
Shot01 + Shot02 + ...
→ VIDEO01

VIDEO01 + VIDEO02 + ...
→ {bookId}.mp4
```

原始 Shot clip、VIDEO 合并结果与最终 Book 成片都保留。

### 5.4 匹配音频 / 倍率

- 生成阶段：真实 `audioDurationSec` 参与导演/视频时长约束。
- 合并阶段：使用真实媒体时长计算倍率。
- 视频比音频长：倍率 > 1，加速。
- 视频比音频短：倍率 < 1，允许慢放。
- 用户可手动 override 倍率。
- 不通过裁剪原视频实现时长匹配。
- TTS/计时音频默认不并入最终声轨。

## 6. Phase 4 — 新版工作台 UI（P0/P1）

固定采用总结文档确定的“水货生产”骨架，不继续自由拖拽主界面。

顶部入口固定：

- 小说列表
- 引擎配置
- AI推理
- 批量操作
- 取消操作
- 任务/日志
- 上传121

### 6.1 主列表

一行一本小说：

`序号 | 小说 | 单书配置 | 预设 | 提示词 | 图片/视频 | 操作`

切换小说时当前 Book 的设置、预设、Prompt、图片、VIDEO、Shot 全同步切换。

### 6.2 单书配置

- 人物场景预设
- 引擎配置
- AI推理

人物/场景/道具统一采用“左 Prompt、右图片”。

### 6.3 引擎配置

同一卡片两个 sibling tabs：

`[模型配置] [发布统一]`

模型配置只放视频/图片/文本模型和运行参数；不放 API Key。

### 6.4 AI推理

四个模块固定：

- 资产设置
- 约束设置
- 视频设置
- 画面设置

AI推理只生成 Prompt/规则，媒体生成统一进入批量操作。

### 6.5 统一 Shot 游标

前端只保留一个当前 Shot 游标；切换 Shot 同步切换：

- preset refs
- 人物/场景/道具图和 Prompt
- visualPrompt
- videoPrompt
- visual image
- video result

不得存在多个区域各自停留在不同 Shot。

Prompt tab：

- 没有 visualPrompt：只显示“视频提示词”。
- 有 visualPrompt：显示“画面提示词 / 视频提示词”。

## 7. Phase 5 — 批量操作 / 121 / 任务日志收口

批量操作固定：

- 人物场景图
- 画面图
- 生视频
- 重试
- 合并

`上传121` 独立负责上传与真实确认；只有来源站真实确认发布后才能进入最终完成状态。

任务/日志不得输出 API Key、Cookie、Authorization、密码。

## 8. 测试矩阵

### Go

- Director → production Shot hydration
- prompt compiler hard rules
- asset reference resolution
- provider capability validation
- per-Shot production
- retry stage selection
- Shot→VIDEO merge planning
- VIDEO→Book merge planning
- audio speed planning (<1 / =1 / >1 / manual override)
- persistence isolation by bookId/videoId/shotId

### Frontend

- fixed workbench skeleton
- one row one book
- top action entries
- global/book inheritance
- single `currentShotIndex`
- Shot navigation sync
- visualPrompt tab conditional rendering
- visualPrompt never reused as video prompt
- asset Prompt+image cards
- batch retry selected books

### Integration

- `go test ./...`
- BF11 Node proxy tests
- BF11 frontend tests
- frontend production build
- existing v88 release contract checks

## 9. 提交策略

按阶段小提交：

1. tests/model: first-class Shot contract
2. feat/model: persist/hydrate Shot
3. tests/compiler: visualPrompt + 有图不用词
4. feat/compiler: new Shot video input compiler
5. tests/production: per-Shot task/retry/merge/audio
6. feat/production: production and merge pipeline
7. tests(ui): fixed workbench / shared Shot cursor
8. feat(ui): new layout and interactions
9. integration/docs: final contract and rollout notes

合回 v88 前必须重新读取最新 v88；若 v88 有并发提交，先把最新 v88 同步进功能分支并重跑全部测试，禁止覆盖并发改动。
