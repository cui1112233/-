# 批量工厂 V12 内嵌式 H3 内核融合设计

日期：2026-09-20

状态：已确认，进入测试先行实施

代码基线：`v88` / `e45f47fa1aee971e21184e3735afc5b1f08b1e87`

## 1. 目标

在现有批量工厂单书工作台内融合 H3 的导演数据、Scene Memory、CanonicalTimeline 和最终 VIDEO Prompt 编译能力，不复制 H3 独立服务、数据库、任务中心和管理界面。

融合后仍以批量工厂现有的书、单书工作台、Director revision、资产、VIDEO 卡、生产任务、合并、打包和 121 上传为外层业务边界。H3 只作为 V12 新运行的内核数据和编译器。

## 2. 冻结依据与现状结论

### 2.1 H3 真实验收 Trace

本设计已读取 H3 发布目录中自身生成的验收包：

`/Users/ming/Downloads/H3批量生产终端_v1.1.2_Final_Windows原生MySQL修复_20260915/runtime/tmp/acceptance-output/ACCEPTANCE001.zip`

该包是 `offline-deterministic` 验收运行的真实产物，不是为 V12 临时编造的测试 JSON。其可验证事实为：

- H3 已处理的“视频原文”有 3 个非空行，CanonicalTimeline 有 3 张原文卡，最终产出 3 段 H3 Prompt。
- `actual_audio_seconds=7.42`，`reference_total_seconds=8`，该样本的确定性时间轴总长为 8 秒。
- 每张原文卡含 `source_index`、`source_key`、`source_text`、`duration_weight`、`character_slot_ids`、`micro_shots`和 `continuity`。
- 最终 H3 Prompt 含人物定义、视听时间轴、画面、连续性、Audio 和 H3 画面约束。

该样本同时有明确限制：`continuity` 为空对象，且时长已按验收逻辑取整。因此它只作为真实产物回归样本，不作为“完整 H3”的最低数据标准。V12 的完整结构以下述 H3 正式类型、导演 Prompt 契约和用户确认的强制字段为准。

### 2.2 H3 正式源码契约

已核对 H3 的导演 Prompt、`quality/models.go`、`timeline/allocator.go`、`timeline/merge.go` 和 H3 最终 Prompt 编译器。其稳定契约是：

- H3 已处理的“视频原文”中，每个非空行必须对应一张、且只对应一张有序导演卡。
- AI 只决定语义结构和相对时长权重，不决定最终秒数。
- `SceneMemory` 是结构化对象，包含场景、轴线、光线、人物位置、朝向、视线、手持道具和动作结束状态。
- CanonicalTimeline 按真实配音参考时长分配，精度为 0.001 秒，浮点差额只修正最后一张卡和其最后一个微镜头。
- 10/15 秒分段先保持未超限的原文卡原子性；只在单卡超限时按微镜头边界拆分，再按原文顺序贪心打包。
- `SourceSlice` 保存最终 VIDEO 段到原文卡和 CanonicalTimeline 区间的反向映射。

### 2.3 现有 V12 结论

当前 V12 仍是 V11 兼容路由，不是 H3 内核：

- Node V12 路由主要把 `/api/batch-factory/v12` 改写到 V11。
- Go 侧 V12 只有升级审计表，没有完整导演数据和时间轴。
- 现有 `DirectorVideo.SceneMemory` 是字符串，镜头结构缺少来源切片、完整连续性和微镜头语义。
- 现有 Director 要求 AI 直接输出最终分段与整数时长，不符合“AI 给权重，后端确定性分配”的 H3 契约。
- 现有 H3 Prompt renderer 可作为过渡编译器，但其输入仍是简化 `DirectorVideo`，必须改为编译 Canonical VIDEO segment。

## 3. 强制产品与数据不变式

1. 不新建 H3 独立服务、数据库、队列、任务中心或前端页面。
2. 保留现有单书工作台、卡片编辑、图片、视频、重试、合并、打包和 121 上传语义。
3. V12 新运行以 H3 已处理的“视频原文”为唯一逐行权威；其每个非空行必须产生一张可追溯导演卡，数量、顺序、文本和来源哈希必须可验证。
4. 新 V12 数据不接受字符串 `scene_memory`、缺少来源的镜头或 AI 给出的最终时长。
5. 真实配音时长是 CanonicalTimeline 的时间权威。没有可验证的配音时长时，不得进入最终 VIDEO 编译与生产。
6. 10/15 秒是后端确定性分段限制，不是提交给 AI 自由决定的建议。
7. 用户可编辑的 VIDEO 文案与实际提交的编译 Prompt 分层保存，两者不得相互伪装。
8. 更换 VIDEO 预设不改写已有导演卡，只创建新的编译修订和生产候选。
9. V11 和旧 V12 修订只读兼容；仅新 V12 Director 运行可写入完整 H3 结构。

### 3.1 “视频原文非空行”的统一定义

“每个非空原文行”在本设计中统一指 H3 视频取文/预处理阶段已经产出并持久化的“视频原文”中的非空行，不是整本小说未经处理文本的自然换行。

- 逐行分解的输入是冻结的 `video_source_text`、`video_source_revision`、`video_source_hash`。
- 行规范化只用于识别空白行；导演卡的 `source_text` 保存该视频原文行的实际文本，不回到整书原文重新切分。
- `source_index` 是视频原文非空行序号，从 1 开始连续递增；`source_key` 在同一视频原文修订中稳定。
- 视频原文变更必须生成新 revision/hash，并使依赖旧修订的 Director、Timeline 和 compilation 失效，但不删除历史 Trace。

## 4. 嵌入式架构

```text
单书/批量入口
    ↓
V12 Director（AI 只产出结构+权重）
    ↓
H3DirectorDocument（按原文行持久化）
    ↓                ↘
真实 TTS 时长          更换 VIDEO 预设
    ↓                    ↓
CanonicalTimeline       复用原 DirectorDocument
    ↓                    ↓
10/15s Segmenter ←── 重编译请求
    ↓
FinalVideoCompilation（可编辑文案 + 实际 Prompt + Trace）
    ↓
现有 VIDEO 生产 / 重试 / 合并 / 打包 / 121
```

内核作为现有 Go `batchfactoryv11` 业务包的焦点模块落地，由 V12 入口启用。不把 H3 项目的运行外壳搬进仓库。包名可保持历史兼容，但新类型和路由必须显式标识 `v12` / `h3` schema，不以“V11 字段加几个可选值”代替新契约。

## 5. 持久化模型

### 5.1 H3DirectorDocument

每个新 V12 Director revision 保存一份不可变的导演文档：

```text
H3DirectorDocument
  schema_version             = "h3-director/v1"
  writer                     = "batch-factory-v12"
  batch_id / book_id / director_revision_id
  video_source_revision / video_source_hash
  video_source_non_empty_line_count
  director_preset_key
  director_preset_revision
  director_prompt_snapshot
  character_roster[]
  relationship_bindings[]
  alias_bindings[]
  scene_memories[]
  director_cards[]
  raw_ai_artifact
  created_at
```

`raw_ai_artifact` 用于 Trace 和诊断，不是业务读取源。业务只读取通过严格校验后的结构化字段。

### 5.2 H3DirectorCard

每个视频原文非空行一张卡：

```text
H3DirectorCard
  source_index               // 视频原文非空行序号，1-based
  source_key                 // 稳定键，如 L001
  source_text                // 当时视频原文修订中的该行文本
  source_text_hash
  visual_context
  preferred_duration         // AI 语义倾向，不是最终时长
  duration_weight            // 分配权重
  character_slot_ids[]
  action
  camera
    shot_size
    shot_angle
    framing
  movement
    camera_movement
    subject_movement
    transition
  rhythm
  audio
    mode
    speaker_slot_id
    dialogue
    voice_over
    sound_effects[]
    ambience[]
  continuity                 // 完整 SceneMemory 对象
  micro_shots[]
```

`continuity` 必须至少持久化：

```text
scene_id, location, axis, light_direction,
positions{}, facings{}, gazes{}, held_props{}, action_ends{}
```

`micro_shots[]` 每项必须持久化：

```text
micro_shot_key, weight, shot_task, visual,
action, character_slot_ids[], camera{}, movement{}, rhythm, audio{}
```

导演卡必须持久化 `character_slot_ids` 字段。视频原文行确实没有出场人物时，允许显式空数组 `[]`，不要求每张卡都有人物；任何非空引用都必须能在当前人物表中解析。不得省略该字段，也不得用未绑定的自由文本人名冒充 slot 绑定。

新 V12 不提供将字符串自动包装成 `SceneMemory.summary` 的写入降级通道。字符串兼容只存在于旧数据读取适配层。

### 5.3 CanonicalTimeline

CanonicalTimeline 是导演数据与最终 VIDEO 编译之间的确定性产物：

```text
CanonicalTimeline
  schema_version             = "h3-canonical-timeline/v1"
  director_revision_id
  audio_asset_id
  audio_content_hash
  audio_duration_ms
  allocator_version
  cards[]
    source_index / source_key
    canonical_start_ms / canonical_end_ms
    canonical_duration_ms
    micro_shots[]
      canonical_start_ms / canonical_end_ms
  created_at
```

时间在数据库和核心算法中使用整数毫秒，只在 API/Trace 展示层转为三位小数秒。这比内核全程使用浮点更容易保证总和不变式。

### 5.4 FinalVideoCompilation

每次编译产生一份不可变的编译修订：

```text
FinalVideoCompilation
  schema_version             = "h3-video-compilation/v1"
  compilation_id
  director_revision_id
  canonical_timeline_id
  video_preset_key
  video_preset_revision
  video_preset_snapshot
  compiler_key / compiler_version
  max_segment_ms             // 10000 or 15000
  input_hash
  segments[]
    segment_index
    canonical_start_ms / canonical_end_ms
    canonical_duration_ms
    request_duration_ms
    source_slices[]
    micro_shots[]
    editable_copy
    editable_copy_revision
    compiled_prompt
    compiled_prompt_hash
    compile_trace
  created_at
```

`editable_copy` 是 VIDEO 卡显示和用户编辑的文案。`compiled_prompt` 是实际提交给视频模型的 H3 最终 Prompt。生产任务还必须冻结本次提交的 `compiled_prompt`、hash、预设版本、编译版本和完整 Trace，使之不随后续卡片编辑而改变。

### 5.5 存储边界

不复制 H3 的表系。存储方案固定为：

- `H3DirectorDocument` 作为新 schema envelope 保存在现有 `batch_factory_v11_director_revisions.output_json`。Director revision 本来就是不可变、按账号/批次/书隔离的事实源，不新建平行 Director 表。
- 新增 `batch_factory_v12_canonical_timelines` 聚合表，一行保存一个不可变 Timeline revision，包含 owner/batch/book/director revision/audio asset/hash/duration/allocator version/timeline JSON/input hash。
- 新增 `batch_factory_v12_video_compilations` 聚合表，一行保存一个不可变 compilation revision，包含 Timeline ID、预设快照、compiler 版本、分段 JSON、input hash 和时间。
- 现有 `batch_factory_v11_production_tasks.compiled_prompt` 和 `final_prompt_hash` 继续作为实际提交快照；增加可空 `compilation_id`、`compilation_segment_key` 和 `compile_trace_json`，使生产任务能指回具体编译段。旧任务的新字段保持空。

两张 V12 聚合表都使用现有账号、batch、book 和 Director revision 外键/归属契约，不新建书、队列、资产、媒体、合并、打包或上传平行表。

## 6. 确定性时间轴算法

### 6.1 输入校验

编译前必须同时满足：

- Director document 是 `h3-director/v1` 且 writer 为 `batch-factory-v12`。
- 导演卡数等于当时 `video_source_revision` 的非空行数，不与整本小说的自然换行数比较。
- `source_index` 从 1 连续递增，`source_text` 与冻结视频原文逐行一致。
- 每张卡的 `duration_weight > 0`，至少一个微镜头，微镜头权重之和大于 0。
- 每张卡必须显式携带 `character_slot_ids`；允许 `[]`，非空引用必须能在当前人物表中解析。
- Scene Memory 是结构化对象，关键人物状态不得引用未绑定 slot。
- 配音资产存在，内容哈希与当前 `video_source_revision` 匹配，时长大于 0。

任一条失败时，该书停在可重试的 Director 或 Timeline 阶段，不用默认秒数、平均镜头或旧 V11 数据悄悄继续。

### 6.2 时长分配

设真实配音时长为 `T` 毫秒，导演卡权重为 `w[i]`：

1. 对前 `n-1` 张卡计算 `floor(T * w[i] / sum(w))`。
2. 最后一张卡取 `T - sum(previous)`，保证总时长严格等于配音时长。
3. 每张卡内用同样的方法按微镜头权重分配，最后一个微镜头吸收该卡余数。
4. 输出必须满足：无负时长、无重叠、无缝隙、顺序不变、卡和镜头总时长都严格等于 `T`。

不使用 AI 输出的 `start/end/duration` 作为时间权威；它们如出现，只能在 raw artifact 中留存以便诊断。

### 6.3 10/15 秒分段

- 单张导演卡时长不超过上限时，该卡作为不可拆原子单元。
- 单卡超限时，先按微镜头边界拆成最少数量的有序单元。
- 某个单一微镜头仍超限时，这是 Director 结构错误：编译失败并返回精确卡/微镜头位置，不在微镜头中部盲切。
- 再从前到后合并相邻单元，保证每段不超上限。
- 每个最终段持久化完整 `SourceSlice[]`，可回到原文行、原文卡区间和段内区间。

`request_duration_ms` 由视频预设/供应商时长契约对 `canonical_duration_ms` 做确定性映射。若供应商只接受固定档位，编译器记录补齐方式和差额；不改写 CanonicalTimeline。

## 7. 预设与重编译

### 7.1 预设职责

H3 预设必须分为两个可版本化部分：

- `director_contract`：决定导演输出 schema、导演规则、人物和连续性要求。
- `video_compiler`：决定最终 Prompt 格式、模型约束、分辨率、画面政策、Audio 表达和请求时长映射。

导演预设变更会创建新 Director revision，因为它可能改变镜头语义。VIDEO 预设变更只创建新 FinalVideoCompilation，复用原 Director document 和 CanonicalTimeline。

### 7.2 重编译规则

- 重编译不调用文本模型。
- 重编译不新建 Director revision，不更改人物、Scene Memory、微镜头和权重。若新预设改变 10/15 秒上限，分段器可确定性产生不同的 `SourceSlice[]`，但它们必须仍完整映射同一 CanonicalTimeline。
- 配音资产不变时复用 CanonicalTimeline；真实配音时长变更时，重算 Timeline 再编译，仍不重做整书 AI 导演。
- 编译输入 hash 一致时幂等返回原 compilation；预设或用户文案变化时创建新 compilation revision。
- 已提交生产的 compilation 不就地改写。

### 7.3 H3 视觉基线、智能统一与基础设定开关

三层语义必须分离：

1. **H3 视觉基线与人物/场景分析**：始终在后台获取、校验并持久化。任何显示或注入开关都不得跳过、删除或停止保存这些数据。
2. **智能统一**：只控制已保存的 H3 视觉基线和统一视觉约束是否在界面中显示，以及是否注入实际提交给视频模型的最终 Prompt。关闭时只不注入这一层，不删除后台已保存数据。
3. **基础设定**：只控制人物、场景等资产设定描述是否注入最终 Prompt。关闭时不注入资产设定长描述，但不得删除或改写分镜自身已经持久化的人物名字、人物 slot 绑定、动作、机位、运镜、场景和剧情事件。

编译 Trace 必须保存两个开关的有效值，并列出实际注入/未注入的层。同一 Director document 在不同开关组合下只重编译，不重跑人物、场景或导演分析。

## 8. 编辑、Trace 与可观测性

### 8.1 VIDEO 卡编辑

VIDEO 卡保持用户可编辑，但编辑发生在 `editable_copy` 层：

- 普通保存创建文案 revision，不改写 Director document。
- 用户选择“按当前文案重编译”时，后端生成新 compilation，并在 compile trace 中标记 override 来源。
- 重新生成视频创建新媒体候选，不自动替换已选主版本。

### 8.2 Trace 内容

单书工作台提供读取型“H3 运行详情”，至少可查看：

- video source revision、非空行数和 video source hash。
- Director 预设键/版本/快照和原始 AI artifact。
- 逐行导演卡、显式 `character_slot_ids`、Scene Memory 和微镜头。
- 真实配音资产、时长、CanonicalTimeline 和 allocator 版本。
- 最终分段、SourceSlice、canonical/request 时长。
- VIDEO 预设键/版本/快照、compiler 版本。
- 用户可编辑文案、实际 compiled prompt、prompt hash 和编译过程。
- 每次视频模型提交的 request ID、生产任务 ID、提交时间、返回/失败摘要和关联媒体候选。

Trace API 是只读聚合接口，不新建平行任务中心。响应按当前账号、batch 和 book 做归属校验。

## 9. 兼容与写入门禁

### 9.1 读取兼容

- 旧 V11/V12 Director revision 继续显示原有 VIDEO 卡、媒体和操作。
- 旧数据通过 `LegacyDirectorView` 适配层读取，显示“旧版导演数据，无完整 H3 Trace”。
- 不从旧 `scene_memory` 字符串、简化 shot 或旧最终时长反向伪造完整 H3DirectorDocument。
- 旧数据若需完整 H3，用户必须明确发起新 V12 Director 运行，产生新 revision，不覆盖历史。

### 9.2 写入门禁

只有同时满足以下条件的请求可写入 H3 结构：

- 路由为 V12 mutation route。
- 运行模式为 `h3_embedded`。
- writer 为 `batch-factory-v12`。
- schema 严格校验通过。
- 帐户、batch、book、source revision 归属一致。

V11 mutation 不得写入 H3 字段；V12 也不得把旧 V11 结构伪标记为 H3。

## 10. 失败、重试与失效边界

阶段依赖固定为：

```text
video-source
  → director
  → tts-duration
  → canonical-timeline
  → video-compilation
  → video-production
  → merge
  → package
  → 121-upload
```

- 视频原文变更：新 Director revision，后续全部失效；历史修订保留。整书原文只有在导致新的视频原文修订时才触发此链路。
- Director 预设变更：新 Director revision，后续失效。
- 配音资产/时长变更：保留 Director，从 CanonicalTimeline 重算。
- 10/15 秒或 VIDEO 预设变更：保留 Director 和符合条件的 Timeline，只重编译。
- 用户 VIDEO 文案变更：只新建当前 compilation revision。
- 视频供应商失败：重试原 production task 的冻结 compilation，不重跑 Director、TTS 或时间轴。
- 合并、打包或 121 失败：仅重跑该失败阶段，不改动上游媒体候选。

现有“普通生成补缺，显式重新生成创建候选，重试只重跑最后失败步骤”语义保持不变。

## 11. API 与界面变化

### 11.1 API

在现有 `/api/batch-factory/v12` 下增加或正式接管：

- Director 生成/重生：产出 H3DirectorDocument。
- Timeline 计算：只由后端调用，可通过 Trace 读取。
- VIDEO 编译/重编译：接收预设和编辑文案 revision，不接收客户端最终时长。
- VIDEO 生产：必须引用 compilation ID 和 segment ID，服务端从持久化 compilation 取 Prompt。
- H3 Trace 读取：返回导演文档、时间轴、编译修订和生产提交记录。

客户端不得上传 canonical duration、source slices 或 compiled prompt 冒充服务端产物。

### 11.2 单书工作台

- 保留现有 VIDEO 卡和所有图片/视频/合并/打包/121 操作。
- VIDEO 卡默认显示 `editable_copy`，明确标记为“可编辑文案”。
- 每张卡增加只读“查看实际提交 Prompt”和“查看 H3 Trace”入口。
- 显示当前 Director 修订、Timeline 修订、VIDEO 预设和 compilation 修订，防止用户把卡片文案当作已提交 Prompt。
- 旧数据只显示兼容标识和原有操作，不显示伪造 H3 Trace。

## 12. 测试先行顺序

每一阶段都遵循：写一个仅因当前缺失能力失败的测试 → 观察预期失败 → 最小实现 → 目标测试通过 → 完整回归。

### 阶段 0：冻结 Trace 契约

从 `ACCEPTANCE001.zip` 提取并归一化可分发字段，作为仓库 fixture；同时增加一份包含完整 Scene Memory、动作、机位、运镜和来源切片的 schema fixture。两者用途不同：

- 真实验收 fixture：防止丢失 H3 已有产物形式。
- 完整契约 fixture：强制 V12 不得降级为旧样本的空连续性。

首组失败测试必须证明当前代码无法：

- 按冻结视频原文的非空行逐行解析完整导演卡，而不是按整书自然换行。
- 拒绝字符串 Scene Memory。
- 持久化微镜头、`character_slot_ids`、动作、机位、运镜、连续性和权重，并接受无人出场卡的显式空数组。

### 阶段 1：结构化 Director

- schema 校验、非空行 1:1 对齐、人物 slot 引用、严格写入门禁。
- MySQL 和 memory store 往返一致性。
- 旧 V11/V12 只读兼容，不自动升格。

### 阶段 2：CanonicalTimeline

- 真实 TTS 毫秒分配、余数修正、微镜头分配。
- 总和、连续性、顺序和幂等性 property tests。
- 配音缺失、哈希不匹配和 0 时长的阻断测试。

### 阶段 3：10/15 秒分段与 SourceSlice

- 原子卡保留、超长卡按微镜头切分、相邻单元贪心打包。
- 每段不超限、不丢原文、SourceSlice 完全覆盖且无重叠。
- 单一微镜头超限显式失败。

### 阶段 4：最终 VIDEO 编译与 Trace

- 完整 H3 Prompt 金牌测试，包含 subjects、时间轴、画面、Audio、连续性和预设输出约束。
- editable copy 与 compiled prompt 分层保存。
- 实际生产提交与冻结 prompt/hash/trace 完全一致。
- 更换 VIDEO 预设只重编译，Director 调用次数保持不变。
- H3 视觉基线和人物/场景分析始终保存；“智能统一”只切换基线层的显示/注入，“基础设定”只切换资产设定注入。
- 任意开关组合下，分镜自身的人物名字、slot 绑定、动作、机位、运镜、场景和事件仍保留在 compiled prompt。

### 阶段 5：工作台读取与回归

- 展示可编辑文案、实际 Prompt 和 Trace。
- 旧数据显示兼容标识。
- 单书与批量操作使用同一服务端链路。

## 13. 每阶段必跑回归矩阵

| 能力 | 核心结构 | Timeline | 编译 | UI/Trace |
| --- | --- | --- | --- | --- |
| 单书生成文案 | 必跑 | 必跑 | 必跑 | 必跑 |
| 批量生产书籍隔离 | 必跑 | 必跑 | 必跑 | 必跑 |
| 最后失败阶段重试 | 必跑 | 必跑 | 必跑 | 必跑 |
| 显式重新生成候选 | 必跑 | 必跑 | 必跑 | 必跑 |
| 图片生成/主图选择 | 回归 | 回归 | 回归 | 回归 |
| VIDEO 生成/候选/主版本 | 回归 | 回归 | 必跑 | 必跑 |
| 合并顺序与音轨 | 回归 | 必跑 | 必跑 | 回归 |
| 打包内容与 Trace | 回归 | 必跑 | 必跑 | 必跑 |
| 121 上传门禁/回执 | 回归 | 回归 | 回归 | 必跑 |

每阶段至少运行：

- Go `batchfactoryv11`、storage、httpapi 目标包与新 V12/H3 测试。
- Node V12 路由和 V11 兼容路由测试。
- 单书操作、批量编排、重试、合并、打包、121 上传的现有相关回归。
- 前端 API/state/source 测试与生产构建，但不以构建成功替代行为验收。

## 14. 验收标准

1. 新 V12 对冻结视频原文的 N 个非空行持久化恰好 N 张导演卡，且每张卡能反查视频原文修订、行和 hash；整书未经处理自然换行不参与该数量校验。
2. 每张卡都有显式 `character_slot_ids`、动作、机位、运镜、节奏、结构化连续性、时长权重和微镜头；无人出场时允许 `character_slot_ids=[]`，非空引用必须可解析，缺少必填结构会阻断写入。
3. 给定相同 Director document、真实配音时长和 10/15 秒设置，多次运行产生字节级稳定的 CanonicalTimeline 与分段 Trace。
4. CanonicalTimeline 总时长与真实配音时长严格一致，最终分段顺序完整覆盖 Timeline。
5. 更换 VIDEO 预设只新建 compilation，不调用 Director provider，不修改 Director revision ID。
6. VIDEO 卡可编辑文案和实际提交 Prompt 可同时查看，已提交生产任务的 Prompt/hash/Trace 可重启后读回。
7. V11/旧 V12 数据仍可读取和操作原有媒体链，但不会被写成假 H3 结构。
8. 单书操作、批量生产、阶段重试、合并、打包和 121 上传现有契约全部回归通过。
9. 关闭“智能统一”或“基础设定”不会停止 H3 视觉基线、人物和场景分析的获取/保存，也不会从最终 Prompt 中删除分镜事实；Trace 能证明两个开关只控制各自注入层。

## 15. 明确不做

- 不搬运 H3 的用户、权限、队列、任务列表、运维、备份和独立前端。
- 不连接 H3 原数据库作为 V12 生产依赖。
- 不修改现有资产主图、VIDEO 主版本、合并和 121 的业务所有权。
- 不把 AI 输出的秒数当作真实时间轴。
- 不在客户端计算或修正 CanonicalTimeline。
- 不自动覆盖已选主图、主 VIDEO 或已提交生产的编译修订。

## 16. 风险与控制

- **脏工作区风险**：实施中只按明确文件添加到提交，每次提交前审查 staged diff，不清理、重置或覆盖既有未提交改动。
- **旧测试默认 AI 决定时长**：先用新失败测试锁定新契约，再将旧测试改为 legacy-only 或替换为确定性时间轴期望。
- **JSON 载荷过大**：设置服务端数量/字节上限，预设和 raw artifact 可压缩或分离存储，但不牺牲可追溯性。
- **用户编辑破坏结构**：用户只编辑展示文案层，Director document 不可变；需改导演结构时显式新建 Director revision。
- **供应商只接受固定时长**：分离 canonical 时长和 request 时长，保存映射 Trace，合并仍以实际媒体探测为准，不篡改原时间轴。
- **真实供应商/121 环路不可用**：单元和集成测试只能证明代码契约；对外发布前仍必须单独完成提交、轮询、下载/播放、合并、打包和 121 真实回执验收。

## 17. 实施前门禁

本设计文档审阅通过后，才生成逐文件实施计划。实施计划必须从“冻结 Trace 样本 + 第一个预期失败测试”开始，不先修改生产代码。
