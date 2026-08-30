# Qiantie 批量工厂（Batch Factory）完整产品设计、UI、功能、架构与分支地图

> **文档目的**：作为 Codex / ChatGPT / 人工开发者后续继续实现、重建、验收和发布批量工厂时的统一参考，不再依赖聊天记录拼接需求。
>
> **更新时间**：2026-08-30
>
> **文档状态**：产品总规格 / 历史实现地图 / 正式架构迁移说明。
>
> **重要原则**：本文件会明确区分：
>
> - **【最终产品要求】**：后续实现必须满足；
> - **【已实现】**：Git 里已经存在实现；
> - **【历史原型】**：只能参考设计，不允许整分支直接发布；
> - **【迁移中】**：代码存在但正式架构所有权尚未全部迁到 Go；
> - **【Codex 本地报告】**：来自生产机/本地 worktree 盘点，GitHub 远端当前未必可见，必须现场复核。

---

# 0. 一句话定义批量工厂

批量工厂不是“批量调用一次视频 API”，而是一套从 **小说获取 → 批次建立 → 生产方式/Prompt/模型冻结 → 爆款 Hook（可选）→ AI 导演 → 人物/场景/道具绑定 → VIDEO Prompt 编译 → 批量生成 → 状态追踪 → 合并 → 发布配置** 的完整生产工作台。

最终正式架构：

```text
小说获取 / Novel Intake
        ↓
Batch Factory React + Ant Design 工作台
        ↓
Golang Batch Factory API
        ↓
配置快照 / 模型目录 / Prompt / Director / Production
        ↓
数据库 + 模型 Provider + 生产任务 + 媒体
```

Node / Express 只能作为迁移期兼容层，不能继续新增 Batch Factory 业务规则。

---

# 1. 最终正式技术架构

## 1.1 前端

**正式要求：**

- 用户端：React + Ant Design
- 管理端：React + Ant Design
- Batch Factory 路由：`/batch-factory`
- `/settings` 是工作台连接设置，不是 Batch Factory 统一生产设置。

当前 React 路由中 `/batch-factory` 和 `/settings` 是两个独立页面，不能因为 `/settings` 没看到新功能就判断批量工厂没有实现。

## 1.2 后端

正式目标：

```text
React
  ↓ /api/...
Go API
  ├─ batches
  ├─ settings
  ├─ config snapshots
  ├─ book overrides
  ├─ VIDEO overrides
  ├─ director
  ├─ prompt compiler
  ├─ production submit
  ├─ status
  ├─ merge
  └─ publish
```

Node 迁移期只允许：

- 旧接口兼容代理；
- 旧数据一次性迁移/读取；
- 尚未迁移 slice 的临时实现。

**禁止：**

- 在 Node 新增 Batch Factory 业务逻辑；
- React 自己复制一套模型/时长/继承规则；
- Batch Factory 保存 API Key；
- 前端把模型名称、版本、最大时长当可信值提交并直接覆盖服务端定义。

## 1.3 配置与密钥

- 模型 catalog、模型版本、是否可用、最大视频时长、`requiresImageInput` 由 Go 模型系统拥有；
- API Key / provider credential 留在现有 Go credential/model 配置体系；
- Batch Factory 只保存模型引用和冻结快照，不保存密钥。

---

# 2. Batch Factory 入口与小说转入

## 2.1 来源

小说从“小说获取”进入批量工厂。

**最终要求：**

- 小说获取完成后可以转入 Batch Factory；
- 转入只建立 intake / 小说列表，不应自动开始导演；
- 用户先检查统一生产设置，再手动开始；
- 小说元数据尽量沿用小说获取阶段已经识别的信息，不重新猜测。

典型元数据：

- `bookId`
- `title`
- `platform`
- 性别/频道/风格等已识别发布元数据（如果前序已有）
- 源文本

## 2.2 创建批次

创建批次时至少选择：

- 生产方式：`原文直转` / `爆款开头`
- 视频模型
- 当前 Prompt / 配置版本快照

创建后应冻结：

- `videoModelId`
- `videoModelVersionId`
- `videoModelName`
- `maxVideoDuration`
- 当前配置 revision / label
- 当前 preset version map

创建提示应明确：

> 小说已进入批量工厂；已冻结当前后台配置版本，请检查统一设置后开始导演。

---

# 3. 两种生产方式

## 3.1 原文直转（original）

流程：

```text
小说原文
  ↓
AI 导演
  ↓
人物 / 场景 / 道具引用关系
  ↓
VIDEO 拆分
  ↓
最终 VIDEO Prompt 动态编译
  ↓
视频模型
```

原文直转的重点是最大限度保持原文推进，不额外加“爆款 Hook 审核阶段”。

## 3.2 爆款开头（viral）

流程：

```text
小说原文
  ↓
爆款 Hook / 爆款改编
  ↓
用户审核
  ↓
AI 导演
  ↓
人物 / 场景 / 道具
  ↓
VIDEO
```

### 爆款情绪要求

**最终产品要求：情绪必须明显放大。**

例如“生气”不能只是：

- 皱眉；
- 普通不满；
- 轻微提高音量。

应该根据剧情允许程度表现为更强烈可视化行为，例如：

- 砸东西；
- 猛拍桌面；
- 情绪失控；
- 破口大骂；
- 强烈肢体动作；
- 明显冲突升级。

重点是“短视频可感知的情绪放大”，而不是机械在 Prompt 里添加“非常生气”。

---

# 4. 时长设计：指导值不是死规则

## 4.1 15 秒只是例子

历史讨论中出现的 10s / 15s、场景铺垫 3.5–4.5 秒等，只是导演时长判断的示例，不是全局硬规则。

**最终原则：**

- 具体 VIDEO 最大时长由当前视频模型能力决定；
- 导演可以根据“场景/铺垫、动作、冲突、信息密度”等类型做预判；
- 示例区间只能作为 Prompt 指导，不应被写成不可突破的通用 validator；
- 服务端必须保证最终 VIDEO 不超过模型能力。

例如：

- Model A 最大 15s；
- Model B 最大 10s；
- 如果历史设置是 15s，但切到 Model B，最终必须按照 10s 能力重新约束/使导演结果失效，不能继续按 15s 提交。

---

# 5. 固定单 VIDEO

## 5.1 产品定义

打开“固定单 VIDEO”后：

- 不管输入多少小说内容；
- 最终只输出 **1 个 VIDEO**；
- 不继续展示第二、第三个 VIDEO；
- 超出这个 VIDEO 可覆盖的后续小说内容不继续生成；
- 单个 VIDEO 内部允许有多个 shot / 镜头动作；
- VIDEO 总时长仍必须遵守当前模型时长能力。

## 5.2 与模型的关系

正式实现应以服务端冻结的模型能力为准。

例如：

- 当前模型最大 15s → 固定单 VIDEO 可以按 15s 上限规划；
- 当前模型最大 10s → 不能用浏览器强行提交 15s；
- 切换模型导致能力变化 → 旧导演方案需要标记重新导演，而不是静默复用。

---

# 6. Batch Factory 主工作台 UI

## 6.1 总体视觉原则

- React + Ant Design；
- 保持在同一工作台，不频繁跳新页面；
- 大设置使用右侧 Drawer；
- 当前小说/局部设置使用轻量卡片、Modal 或内嵌展开；
- 用户始终知道自己正在操作“当前批次 / 当前小说 / 当前 VIDEO”中的哪一层。

## 6.2 预览工作台四卡片设计

历史批准的 Preview / 可拖动工作区设计包含四个核心区域：

1. `book-list`：小说列表
2. `book-workbench`：当前小说工作台
3. `preview`：预览/结果
4. `batch-tools`：批量工具

`workspace-layout.js` 中使用：

- 12 列网格
- 默认行高 48
- 默认 gap 12
- 本地布局存储 key：`qiantie:batch-factory:layout:v1`

历史默认布局：

```text
┌───────────────┬────────────────────────────┬────────────────────┐
│ 小说列表       │ 当前小说工作台              │ 预览                │
│ x=0,w=3       │ x=3,w=5                    │ x=8,w=4            │
│ h≈10          │ h≈10                       │ h≈6                │
│               │                            ├────────────────────┤
│               │                            │ 批量工具            │
│               │                            │ x=8,w=4,h≈4        │
└───────────────┴────────────────────────────┴────────────────────┘
```

这套 Preview UI 是设计资产，不代表每个正式 release 当前都已经使用同一布局。

## 6.3 顶部能力

主工作台应提供：

- 当前批次标题/数量；
- 生产统一设置；
- 发布统一设置；
- 当前配置版本摘要；
- 视频模型摘要；
- 当前模式摘要；
- 导演 / 生产 / 合并 / 上传等快捷动作；
- 批次/小说状态过滤；
- “有单书设置”的过滤或标识。

## 6.4 小说列表

每本小说至少显示：

- 标题
- bookId
- 平台
- 当前状态
- 当前是否有单书 override
- 是否已完成 Hook
- 是否已完成导演
- 是否已有生产 project
- 视频是否全部成功
- 是否已合并
- 失败/异常标识

点击小说切换中间“当前小说工作台”。

---

# 7. 生产统一设置（最终 UI）

## 7.1 容器

**最终要求：右侧宽 Drawer，不跳页面。**

不能再使用“进入新设置页面”。

最终交互：

```text
[生产统一设置]
      ↓
右侧 Drawer 滑出
      ↓
设置 / 保存
      ↓
关闭后仍在原 Batch Factory 工作台
```

宽度应以桌面端易编辑为准，后续正式实现建议保持“宽 Drawer”级别；历史实现出现过 620px，后续修订目标为更宽的 720–860px 区间。宽度不是业务规则，但不能退回窄 Modal。

### Drawer 顶部

至少显示：

- `生产统一设置`
- `应用于当前批次 · N 本小说`
- 保存按钮
- 关闭按钮

## 7.2 内容顺序

**最终批准顺序：**

1. 配置版本
2. 基础生产设置
3. 约束设置（独立分区，在基础设置下面）

“配置版本”不能藏到二级高级设置里。

---

# 8. 配置版本设计

## 8.1 目的

后台 Prompt/config 发布新版本后，正在跑的批次不能被静默改变。

Batch Factory 必须冻结版本：

- 当前 revision
- 当前 label/name
- preset versions
- sync time

典型字段：

- `systemConfigRevision`
- `systemConfigLabel`
- `systemConfigSyncedAt`
- `systemPresetVersions`

## 8.2 UI

```text
配置版本
┌───────────────────────────────────────────────┐
│ 当前：批量配置 V3.2                           │
│ [选择历史/当前版本 ▼]      [后台最新] / [可同步] │
│                                   [同步批量后台配置] │
└───────────────────────────────────────────────┘
```

规则：

- 可以选择已经发布的历史配置；
- 可以同步后台最新配置；
- 后台发布新版本不会自动覆盖当前批次；
- 点击同步只是把新快照载入当前设置，仍需保存才生效；
- 同步批次配置不能清空当前小说 / VIDEO 手动覆盖。

## 8.3 生产方式变更保护

如果批次已经开始导演：

- 生产方式不能无提示直接改；
- 已经完成导演的小说不自动重新生成；
- 如果需要重新导演，要明确用户确认。

历史验收用“已经有 46 本完成导演”作为示例，因此界面应显示动态数量警告，例如：

> 当前已有 46 本完成导演，本次模式/模型变化不会自动重做这些小说。

**46 不是硬编码业务数字，应动态计算。**

---

# 9. 基础生产设置

## 9.1 生产方式

- 原文直转
- 爆款开头

## 9.2 视频模型

下拉列表来源：Go model catalog。

显示至少：

```text
模型名称 · 最大 Ns
```

筛选规则：

- `kind === video`
- 批量工厂直接文生视频场景默认排除 `requiresImageInput === true`
- `maxVideoDuration >= 1`

浏览器展示的 `versionId / name / max duration` 不是权威值；保存时服务端重新 canonicalize。

## 9.3 视频画幅

至少：

- `9:16`
- `16:9`

必须随每一个 VIDEO 请求一起提交，不是只保存到批次 UI。

## 9.4 剧本 Prompt

选择当前剧本 Prompt preset。

历史默认：

- `standard-short-drama`

实际生产必须冻结具体版本，不只保存 ID。

## 9.5 人物 / 场景 Prompt

选择基础资产提取/人物场景 Prompt preset。

历史默认：

- `standard-asset-extraction`

## 9.6 固定单 VIDEO

见第 5 章。

## 9.7 前缀模式

至少支持：

- `auto`：AI 根据视频/题材判断前缀，然后可追加统一前缀；
- `manual`：只使用用户指定统一前缀。

前缀必须加入每个 VIDEO 最终请求。

## 9.8 字幕策略

至少：

- `forbid-auto-dialogue-subtitle`：禁止模型自动生成对白字幕；
- `allow`：允许。

历史视觉约束中也出现过“禁止字幕、禁止 Q 版、保持服装一致”等要求；这些应通过 Prompt preset/约束层实现，不要无条件散落硬编码在多个地方。

---

# 10. 约束设置（最终交互）

## 10.1 位置

约束设置必须与基础生产设置分隔，在统一设置 Drawer 下半部分单独成组。

## 10.2 最终包含项

核心约束：

1. 基础设定（人物 / 场景）
2. 人物 Prompt 注入
3. 场景 Prompt 注入
4. 道具 Prompt 注入
5. 画面前缀词
6. 画质约束
7. 画面限制
8. 负面提示词
9. 字幕策略（可以位于基础设置，但最终编译属于约束）

## 10.3 关键 UX：开关打开即直接编辑

**最终要求：不再有“开关 + 铅笔编辑按钮”。**

错误旧交互：

```text
画质约束       [ON] [✎ 编辑]
```

最终正确交互：

```text
画质约束                      [ON]
┌──────────────────────────────────────┐
│ 系统预设 | 我的提示词                │
│ [预设选择 ▼]                         │
│                                      │
│ 提示词内容                           │
│ [..................................] │
│ [..................................] │
│                                      │
│ [保存当前草稿] [保存为我的提示词]     │
└──────────────────────────────────────┘
```

关闭开关：

- 编辑区域折叠；
- 当前文本可以保留；
- 最终 prompt 编译不注入该约束；
- 再次打开恢复之前内容。

## 10.4 系统预设 / 我的提示词

历史已实现的 Inline Constraint 设计：

每个文本约束可以选择：

- 系统预设
- 我的提示词
- 当前草稿

### 系统预设

- 选择系统 preset；
- 读取 preset body；
- 可以复制到当前设置后继续编辑；
- 编辑当前 body 不能修改系统 preset 本身。

### 我的提示词

- 用户可以保存命名 Prompt；
- 下次在剧本生成和 Batch Factory 继续选择；
- 可以编辑自己的 Prompt；
- 可以删除；
- 删除当前正在引用的个人 Prompt 后，当前层应退回 draft/普通文本，不应直接丢失用户正在编辑的 body。

### 当前草稿

- 只保留在当前设置层；
- 不进入公共/个人 Prompt 库。

## 10.5 基础设定注入

“基础设定（人物 / 场景）”开启后：

- 根据当前 VIDEO 实际引用关系注入人物设定；
- 根据当前 VIDEO 实际引用关系注入场景设定；
- 不能把全书所有人物/场景无脑塞入每个 VIDEO。

道具同理，应只注入当前 VIDEO 引用道具。

---

# 11. 设置继承模型

最终有效设置层级：

```text
system
  ↓
batch / 生产统一设置
  ↓
book / 当前小说 sparse override
  ↓
video / 单 VIDEO sparse override
```

即：

```text
system < batch < book < video
```

## 11.1 Sparse Override

当前小说 / VIDEO 只保存“自己覆盖的字段”，不要复制一份完整 batch settings。

例如：

```json
{
  "qualityEnabled": false,
  "aspectRatio": "16:9"
}
```

表示其他字段继续继承 batch。

## 11.2 显式 false / 空字符串必须保留

不能使用简单的 truthy merge：

```js
child.value || parent.value
```

否则：

- `false` 会被父级 true 覆盖；
- `""` 会被父级非空文本覆盖。

必须根据“字段是否存在”判断 override。

## 11.3 恢复继承

“恢复继承”不是把父级当前值复制到子层。

正确语义：

- 删除子层 override key；
- 后续父级修改后，子层自然跟随。

## 11.4 统一设置与单书 override

统一设置保存时：

- 默认不要清空现有单书 override；
- UI 应显示哪些小说已经覆盖；
- 如果提供“强制应用全部”的模式，必须明确提示会清除对应 override；
- “跟随/保留覆盖”与“强制全部”不能混淆。

历史原型曾设计：

- 当前批次 100 本；
- footer 显示多少本跟随、多少本有 override；
- force-all 会清对应单书覆盖。

该数字必须按实际批次动态计算。

---

# 12. 当前小说设置

## 12.1 入口

小说列表/当前小说工作台应提供“当前小说设置”入口，并显示 override badge。

## 12.2 当前小说版本配置

最终设计包含单书版本 override：

- 默认跟随批次配置版本；
- 可以为单书选择其他版本；
- 显示“继承批次 / 当前层已覆盖”；
- 可以恢复继承。

## 12.3 当前小说约束卡片

点击当前小说“约束设置”后，使用轻量 Modal / 弹跳卡片，不需要再跳入完整设置页。

内部复用与统一设置相同的约束编辑器：

- 基础设定
- 画面前缀词
- 画质约束
- 画面限制
- 负面提示词
- 人/场景/道具注入

保存后只写 `item.settingsOverride` 的 sparse patch。

界面显示：

- 当前覆盖数量；
- “当前层已覆盖”标记；
- “恢复跟随批次统一设置”。

---

# 13. 单 VIDEO 设置

VIDEO 层是最高优先级 override。

可覆盖字段至少包括：

- `aspectRatio`
- `prefixMode`
- `customPrefix`
- `prefixEnabled`
- `injectCharacterPrompt`
- `injectScenePrompt`
- `injectPropPrompt`
- `quality`
- `qualityEnabled`
- `restriction`
- `restrictionEnabled`
- `negative`
- `negativeEnabled`
- `subtitlePolicy`

每个字段应可：

- 继承当前小说/批次；
- 当前 VIDEO 单独覆盖；
- 恢复继承。

---

# 14. AI 导演设计

## 14.1 导演前冻结模型

新批次应在导演前锁定视频模型，因为导演必须知道：

- 单次最大时长；
- 是否文生视频；
- 可用画幅/能力。

导演完成后不能在“生成视频”阶段随意换模型。

## 14.2 Director 输出

导演至少需要输出/保存：

- storyboard / VIDEO 列表
- 每 VIDEO duration
- visual prompt / story content
- source coverage
- 人物引用
- 场景引用
- 道具引用
- prompt/config version metadata

## 14.3 visualPrompt 与约束分离

`visualPrompt` / `video_desc` 只表达剧情与视觉内容。

不要把：

- 画质
- 前缀
- 负面提示
- 字幕策略
- 画幅
- 人物设定全文

永久写死进 director story description。

这些应该在最终 VIDEO Prompt Compiler 动态注入。

## 14.4 模型变化导致 Director 失效

如果修改模型导致：

- 最大时长变化；
- 能力不再兼容；

必须标记 director result 需要 regeneration。

不能“旧导演 15s + 新模型 10s”直接提交。

---

# 15. 最终 VIDEO Prompt Compiler

最终生产请求必须由唯一 compiler 构造。

```text
Director 视觉内容
+ 当前 VIDEO 人物
+ 当前 VIDEO 场景
+ 当前 VIDEO 道具
+ 画面前缀词
+ 画质约束
+ 画面限制
+ 负面提示词
+ 字幕策略
+ aspect ratio
+ duration
= 最终上传给视频模型的 Prompt / payload
```

## 15.1 关键要求

- 每一个 VIDEO 都重复携带自己需要的约束；
- 不是只在 batch 开头发送一次；
- 人物/场景/道具只按引用关系注入；
- 画幅每个 VIDEO 都发；
- 前缀每个 VIDEO 都发；
- 最终“查看上传 Prompt”和真正生产必须调用同一个 compiler，防止预览与实际请求不一致。

---

# 16. 视频生产设计

## 16.1 单本生成

当前小说 Director 完成后，可“生成全部 VIDEO”。

如果批次已经绑定模型：

- 不再显示可任意更换模型的下拉；
- 显示绑定模型；
- 显示单次最大时长；
- 显示画幅；
- 直接用冻结模型生成。

如果绑定模型当前被后台停用/隐藏：

- 警告用户恢复原模型；
- 不允许偷偷换另一模型继续跑旧导演方案。

## 16.2 历史批次兼容

旧批次可能没有 `videoModelId`。

兼容模式：

- 允许临时选择文生视频模型；
- 模型最大时长必须 >= 历史导演上限；
- 图生视频模型不显示在无图直出列表。

## 16.3 生产失败

应区分：

- Prompt 编译失败；
- provider/submit 失败；
- 部分 VIDEO 入队失败。

UI 应显示：

- queued / total
- failed count
- production project id
- model name
- 错误原因

---

# 17. 整批生产

## 17.1 触发

“生成全部待生产小说”只处理：

- Director 已完成；
- 有 storyboard；
- 尚未创建生产 project 的小说。

## 17.2 批量行为

历史实现要求：

- 浏览器只发 1 次批量请求；
- 服务端控制并发；
- 当前 UI 原型显示“服务端并发 3”；
- 逐本创建正式生产 project；
- 每本内部全部 VIDEO 入队；
- 结果返回成功小说数 / 失败小说数 / queued video 数。

正式 Go 迁移后并发和排序应由服务端控制，不能靠浏览器循环 100 次请求。

---

# 18. 视频状态工作台

状态需要聚合：

- Director 状态
- production task 状态
- media 状态
- merge 状态

典型小说状态：

- `pending`
- `queued_hook`
- `hook_generating`
- `hook_review`
- `queued_director`
- `director_generating`
- `complete`
- `failed`

视频状态：

- draft
- queued
- running
- succeeded
- failed
- cancelled

UI 应可以展开每个 VIDEO，查看：

- 实际 task
- segment id
- media
- 错误
- 最终状态

---

# 19. 合并设计

当前 React 实现中存在两种合并策略：

## 19.1 固定倍率

可选择固定速度，例如历史 UI：

- 1.0x
- 1.1x
- 1.2x
- 1.3x
- 1.5x
- 1.7x
- 2.0x

## 19.2 跟随音频时长

可使用 TTS 测算目标音频时长：

- 根据 narration 生成/测量音频；
- `ratio = 视频原始总时长 / 音频目标时长`；
- 只在合理压缩区间使用；
- 历史实现不自动慢放视频。

合并完成后生成当前 book 的 merged media。

---

# 20. 发布统一设置

## 20.1 容器

最终要求同样优先右侧 Drawer，不跳页面。

## 20.2 发布配置版本

类似小说获取的“版本配置”：

- 选择批量发布配置版本；
- 显示当前版本；
- 显示后台是否有更新；
- 点击“同步最新配置”；
- 后台新版本不自动覆盖当前批次；
- 同步后保存才生效。

典型字段：

- `configProfileKey`
- `configProfileName`
- `configProfileVersion`
- `configProfileSyncedAt`

## 20.3 视频管理系统账号

历史实现包含：

- 验证账号在线状态；
- 显示账号名称；
- 失效显示错误；
- “重新登录”；
- 打开登录窗口后轮询恢复在线。

## 20.4 发布参数

当前已出现：

- 素材复用
- 水平翻转

历史原型还出现过：

- 合并上传
- 默认 1.5x
- 解压/滚动/生成数量策略
- 解压速度约 1.7
- pitch
- 最终 AI 头部
- VIDEO 01
- TXT 上传

这些属于历史发布工作台设计参考，是否进入正式 release 必须以 production snapshot 上的实际发布链为准，不能因为旧原型存在就自动上线。

发布元数据如平台/性别/风格优先沿用小说获取已识别值。

---

# 21. 历史原型默认配置（仅参考，不得当成硬规则）

早期 prototype 曾出现：

- 配置版本：V3.2 / V3.1 / V3.3-beta
- 默认模式：爆款开头
- 默认模型：Model A
- 默认画幅：9:16
- 固定时长示例：10s
- 视觉风格：高质量动漫短视频
- fixed single video 默认：false
- 约束：人物/场景、画面前缀、画质、画面限制、负面提示

这些是设计/验收素材，不是当前 Go catalog 的真实默认值。

---

# 22. 当前核心数据模型

## 22.1 Batch

至少：

```text
id
mode
sourceIntakeId
settings
publishSettings
items[]
createdAt / updatedAt
```

## 22.2 Batch settings

关键字段：

```text
videoModelId
videoModelVersionId
videoModelName
maxVideoDuration
aspectRatio
fixedSingleVideo
prefixMode
customPrefix
prefixEnabled
scriptPromptPresetId
assetPromptPresetId
injectCharacterPrompt
injectScenePrompt
injectPropPrompt
quality
qualityEnabled
restriction
restrictionEnabled
negative
negativeEnabled
subtitlePolicy
systemConfigRevision
systemConfigLabel
systemConfigSyncedAt
systemPresetVersions
```

Inline Constraint 历史实现还有：

```text
constraintPrefixEnabled
constraintQualityEnabled
constraintRestrictionEnabled
constraintNegativeEnabled
constraint{Category}Source
constraint{Category}PresetId
constraint{Category}PersonalPromptId
```

这些字段未来 Go 正式 schema 应统一命名，不应长期维护两套同义字段。

## 22.3 Item / Book

至少：

```text
id
bookId
title
sourceText
status
settingsOverride
hookScript / approvedHookScript
directorResult
production
productionResults
productionSubmissionError
```

## 22.4 VIDEO

Director storyboard 的每个 VIDEO 至少包含：

- 顺序/index
- duration
- visual content
- entity references
- sparse override
- production task/media mapping

---

# 23. API 设计

## 23.1 最终 Go API 方向

建议正式接口族：

```text
GET    /api/batch-factory/batches
POST   /api/batch-factory/batches
GET    /api/batch-factory/batches/{batchId}
PUT    /api/batch-factory/batches/{batchId}/settings
PUT    /api/batch-factory/batches/{batchId}/publish-settings
PUT    /api/batch-factory/batches/{batchId}/items/{itemId}/overrides
PUT    /api/batch-factory/batches/{batchId}/items/{itemId}/videos/{videoId}/overrides
GET    /api/batch-factory/config-versions
POST   /api/batch-factory/batches/{batchId}/director
POST   /api/batch-factory/batches/{batchId}/items/{itemId}/director
GET    /api/batch-factory/batches/{batchId}/items/{itemId}/videos/{videoId}/compiled-prompt
POST   /api/batch-factory/batches/{batchId}/generate
POST   /api/batch-factory/batches/{batchId}/items/{itemId}/generate
```

## 23.2 当前 Go Migration 已存在的接口

### Settings canonicalization

```text
POST /api/shuihuo-production/batch-factory/settings/canonicalize
POST /api/shuihuo-production/batch-factory/overrides/canonicalize
```

### Config snapshot

```text
POST /api/shuihuo-production/batch-factory/config-snapshots/resolve
POST /api/shuihuo-production/batch-factory/presets/resolve
```

### Director contract / normalize

```text
POST /api/shuihuo-production/batch-factory/hook/contract
POST /api/shuihuo-production/batch-factory/director/contract
POST /api/shuihuo-production/batch-factory/director/normalize
```

这些是渐进迁移端点，最终可以按正式 router 统一。

---

# 24. Go Batch Factory 实现位置

分支：`10-batch-factory-go-api-migration`

远端 head（2026-08-30 盘点）：

`b02632d77d299f3106483b6b37621019cd9ca1dc`

## 24.1 Go 核心

```text
backend/internal/shuihuo/batchfactory/
```

当前关键文件：

```text
config_snapshots.go
config_snapshots_test.go
director_output.go
director_output_test.go
director_prompt.go
director_prompt_test.go
settings.go
settings_test.go
settings_store.go
settings_store_test.go
```

职责：

- settings canonicalization
- model snapshot validation
- settings persistence
- sparse override persistence
- config snapshot / preset resolution
- director prompt contract
- director output normalization

## 24.2 Go HTTP

```text
backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go
backend/internal/httpapi/shuihuo_batch_factory_director_handlers.go
```

以及 router 注册相关文件。

## 24.3 MySQL migration

```text
backend/internal/storage/migrations/028_batch_factory_settings.sql
```

目前主要解决 settings / override 持久化；完整 Batch 主数据仍需后续迁 Go/MySQL。

---

# 25. Node 兼容层位置

分支：`10-batch-factory-go-api-migration`

```text
lib/batch-factory/
```

当前重要文件：

```text
config-snapshot-bridge.js
config-version.js
director-bridge.js
director-output.js
effective-settings.js
production-bridge.js
prompt-admin-presets.js
prompt-selection.js
settings-aware-store.js
settings-state-bridge.js
store.js
video-prompt-compiler.js
```

主要含义：

- `*-bridge.js`：迁移期把旧 Node 路径接到 Go；
- `effective-settings.js`：当前有效设置继承仍有 Node 所有权；
- `store.js`：主 Batch 数据仍有 file-backed Node 存储；
- `video-prompt-compiler.js`：最终 VIDEO Prompt 编译仍未完全迁 Go；
- `production-bridge.js`：生产仍有 Node → Go/水货生产桥接。

这些不是最终架构，应逐 slice 移走。

---

# 26. React 实现位置

## 26.1 当前 V10 页面

```text
frontend/src/user/pages/BatchFactoryPageV10.jsx
```

## 26.2 Batch Factory 组件

在不同历史分支中出现两组实现。

### `10-batch-factory-go-api-migration`

典型：

```text
frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx
frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx
frontend/src/user/pages/batch-factory/BatchFactorySettingsModals.jsx
frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx
frontend/src/user/pages/batch-factory/batch-factory-settings.css
frontend/src/user/pages/batch-factory/intake.js
```

注意：该线中的 `BatchFactorySettingsModals.jsx` 曾回退成 Modal + 独立编辑按钮，不完全符合最终 UI。

### `10-batch-factory-inline-constraints-version-config`

这是最终 UI 设计参考的重要历史线：

```text
frontend/src/user/pages/batch-factory/BatchConstraintSettings.jsx
frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx
frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx
frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx
frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx
frontend/src/user/pages/batch-factory/workspace-layout.js
frontend/src/user/pages/batch-factory/intake.js
```

这条线已经出现：

- 生产统一设置 Drawer
- 发布统一设置 Drawer
- 开关打开后直接展开约束编辑
- 系统预设 / 我的提示词
- 当前草稿
- 单书约束
- workspace layout

但它不是可以整分支直接 merge 的正式生产基础。

---

# 27. Batch Factory 远端分支地图

以下 head 来自 2026-08-30 GitHub 远端盘点。

| 分支 | Head | 主要含义 | 使用方式 |
|---|---|---|---|
| `05-batch-factory-director-pipeline` | `001bf7a9521337b80a1853987312991770829ee0` | 早期导演 pipeline | 历史功能参考 |
| `06-batch-factory-novel-fetch-handoff` | `14b2214ef3441b96f8029a172c3bbd532f99a7bb` | 小说获取 → Batch Factory handoff | 入口/数据流参考 |
| `07-batch-factory-v8-react-antd` | `a83dd9995cade6e2ad798f9a26c087785336e9ed` | React + AntD V8 工作台线 | UI/正式前端演进参考 |
| `08-batch-factory-independent-pipeline` | `881e95bde7bc6bb89693305e1f2795f3af94229f` | 一套独立 pipeline 架构 | 不得整分支合入 |
| `08-batch-factory-unified-settings-version-sync` | `b57f626c81d3ed9f16cf1edf3965326d14b82386` | 统一设置/版本同步设计 | 功能参考/择取 |
| `09-batch-factory-independent-pipeline` | `fb1ea271c66950c94b4b834a4d7d4233fecb03d7` | 另一套独立 pipeline | 不得整分支合入 |
| `09-batch-factory-video-model-selector` | `61d600004af1ea990ad9d605c97a4b163ba74445` | 统一视频模型选择/冻结 | Go 迁移基线之一 |
| `10-batch-factory-go-api-migration` | `b02632d77d299f3106483b6b37621019cd9ca1dc` | 正式架构向 Go 迁移 | 后端架构主参考 |
| `10-batch-factory-inline-constraints-version-config` | `4be9b359d2878562634aace57e566690a0fda34f` | Inline Constraint + Drawer + workspace/version 设计 | 最终 UI/交互主参考，不整分支 merge |
| `feature/batch-factory-frame-closure-20260827` | `e9274f3c1e66e0ec4b06c2b169e10592b2647500` | Frame/工作台阶段收口 | 历史 UI 参考 |
| `integration/go-batch-baseline-20260830` | `e0142e701c8199f049fd30fcd532020c013f9604` | Go Batch baseline integration | 集成参考，发布需单独验 |
| `release/preset-migration-b02632d` | `3875f0183c756c49c7d6c88d47968164f2dac071` | 74b1 线上的 Preset Migration release 验证 | 不是最终 V78 生产基线 |

---

# 28. Codex 本地 production snapshot / release 线

**【Codex 本地报告，不是本文件生成时可从 GitHub 远端确认的分支】**

Codex 后续盘点报告：

```text
release/production-v78.3.0.3-preset-migration @ 9baa60a
```

含义：

- 基于真实线上 `V78.3.0.3` snapshot；
- 已叠 Preset Migration；
- 包含现有 Batch Factory Preview 工作台。

另有 Drawer UI 修复提交：

```text
9f73627
```

Codex 报告该提交与 `9baa60a` 的 Batch Factory 文件基线一致，可以独立叠加。

**但在本文件生成时，GitHub 远端未找到 `9f73627`，`release/production-v78.3.0.3-preset-migration` 也未出现在远端 branch API。**

因此 Codex 后续必须：

1. 在本地 production snapshot worktree 复核；
2. 不要用远端 `master@74b1` 代替真实 V78 production baseline；
3. 不要因为本文件列出该 SHA 就默认远端已保存。

---

# 29. 为什么 08 / 09 / 10 不能直接全部 merge

这些 branch 不是线性“版本 8 → 9 → 10”的简单补丁链。

目前已知：

- `08-batch-factory-independent-pipeline`
- `09-batch-factory-independent-pipeline`
- `10-batch-factory-inline-constraints-version-config`
- `10-batch-factory-go-api-migration`

包含不同架构取向和不同页面组织。

尤其：

- 一个分支可能拥有更好的 UI；
- 另一个分支拥有更正确的 Go ownership；
- 另一个分支拥有 production baseline 兼容；
- 直接 merge 会把已经验证的正式 V78 页面替换成另一历史 UI。

**正式策略：以 production snapshot 为唯一发布基线，按功能逐组重建/cherry-pick/人工移植。**

---

# 30. Go 迁移阶段与当前状态

## Phase 1 — Settings / Video Model

### 已做

- Go settings canonicalization；
- model availability validation；
- model version/name/max duration canonicalization；
- unified settings；
- sparse overrides；
- MySQL settings store；
- Node bridge。

### 仍需最终生产验证

- 主 Batch ownership 仍未完全迁 Go；
- arbitrary batch marker / legacy ownership 等历史边界要随 Phase 4 主数据迁移解决。

## Phase 2 — Config Snapshots

### 已做

- Go config snapshot resolution；
- preset selection / historical frozen version resolution；
- Node bridge。

## Phase 3 — Director

### 已做/部分完成

- Go director prompt contract；
- Go output normalize；
- Hook/Director contract HTTP；
- Node director bridge。

### 尚未全部 Go-owned

- 实际 text provider 调用；
- Hook JSON parse 全链；
- queue/state machine；
- director persistence 主数据。

## Phase 4 — Effective Settings + Prompt Compiler

目标：

- `system < batch < book < video`
- Go effective settings
- Go final VIDEO compiler
- preview 与 production 同 compiler

**当前仍未完全迁完。**

## Phase 5 — Production

目标：

- 单本生成
- 整批生成
- bound-model validation
- per VIDEO payload
- Go persistence

**当前仍有 Node bridge。**

## Phase 6 — Status / Merge / Publish

目标：

- 状态聚合
- merge
- publish
- 删除 Batch Factory Node 业务路由

**尚未最终完成。**

---

# 31. 当前明确缺口

截至上述 Git 状态，不能宣称“最终完整批量工厂全部完成”。

主要缺口：

1. 主 Batch 数据仍有 Node file-backed `store.js`；
2. effective settings 仍有 Node 所有权；
3. final VIDEO prompt compiler 仍主要在 Node；
4. production orchestration 仍有 bridge；
5. publish real endpoint 仍需结合正式发布系统；
6. 多个历史 UI/功能线尚未安全重建到 production snapshot；
7. `10-batch-factory-go-api-migration` 的统一设置曾回退成 Modal，不符合最终 Drawer 要求；
8. 该线约束曾存在独立铅笔编辑按钮，不符合“开关打开直接编辑”；
9. production snapshot 上的 Drawer 修复/完整功能必须以 Codex 本地 release worktree 为准重新验收；
10. `master` 不是当前生产 V78 的可复现发布基线。

---

# 32. Preset Store 迁移（与 Batch Factory 发布强相关）

旧线上 Docker volume 中存在历史：

```text
data/system/presets.json
data/system/preset-audit.json
```

新版严格 preset schema 曾导致：

```text
Error: Invalid preset store
```

Node 服务启动退出，平台容器循环重启。

已实现向后兼容迁移：

```text
lib/preset-store-migration.js
lib/preset-store-schema.js
lib/preset-store.js
scripts/verify-preset-volume-upgrade.sh
```

测试：

```text
test/preset-store-schema.test.js
test/preset-store-migration.test.js
test/preset-store-startup-migration.test.js
test/preset-volume-upgrade-script.test.js
```

迁移要求：

- 原字节备份；
- schema marker；
- quarantine；
- audit；
- 原子写回；
- 幂等；
- 单条无法识别不能拖死全平台。

这不是 Batch Factory 业务功能，但它是任何包含新 Prompt/Batch Factory 版本的正式发布门禁。

---

# 33. 测试与验收设计

## 33.1 自动测试

至少：

### Preset

```text
node --test \
  test/preset-store-schema.test.js \
  test/preset-store-migration.test.js \
  test/preset-store-startup-migration.test.js \
  test/preset-volume-upgrade-script.test.js
```

### Batch Factory

```text
node --test test/batch-factory.test.js
```

### Go

```text
cd backend
go test ./...
```

### Frontend

```text
npm --prefix frontend ci
npm --prefix frontend run build
```

## 33.2 Batch Factory UI 验收

必须逐项验：

### 入口

- 小说获取转入；
- 不自动导演；
- 批次建立。

### 统一设置

- Drawer；
- 配置版本在基础设置之前；
- 同步批量后台配置；
- 原文直转/爆款开头；
- 视频模型；
- 9:16 / 16:9；
- fixed single VIDEO；
- 保存刷新恢复。

### 约束

- 基础人物/场景；
- 人物/场景/道具注入；
- Prefix；
- Quality；
- Restriction；
- Negative；
- switch 打开直接编辑；
- switch 关闭折叠但值不丢；
- 系统预设；
- 我的提示词；
- 草稿；
- 保存/删除个人提示词。

### 单书

- 单书 override badge；
- 单书配置版本；
- 单书约束卡；
- 恢复继承；
- 批次保存不能无故清覆盖。

### VIDEO

- 单 VIDEO override；
- 恢复继承；
- final effective settings 正确。

### Director

- original；
- viral Hook；
- Hook review；
- 情绪放大；
- fixed single video；
- 模型时长约束；
- 模型切换失效保护。

### Production

- 单本生成；
- 整批生成；
- bound model；
- historical batch fallback；
- 部分失败显示；
- project/task/media 状态；
- 打开生产页。

### Final Prompt

抽查一个 VIDEO 最终请求必须包含：

- visual prompt
- 当前人物
- 当前场景
- 当前道具
- prefix
- quality
- restriction
- negative
- subtitle policy
- aspect ratio
- duration

并确认 preview 与实际 submit 内容来自同一 compiler。

### Merge

- 全部 VIDEO 完成后可合并；
- fixed speed；
- audio duration strategy；
- merged media 可见。

### Publish

- 发布统一设置 Drawer；
- 版本选择；
- sync latest；
- 视频管理账号；
- 素材复用；
- horizontal flip；
- 其他发布字段按 production release 实际实现验收。

---

# 34. 正式发布规则

## 34.1 唯一正确基线

当前生产页面版本 V78.3.0.3 与远端 `master@74b1...` 不是同一精确源码基线。

因此：

- 不允许从 master 直接构建并替换生产；
- 必须以 production snapshot 为基线；
- 将验证过的功能独立叠到 snapshot；
- 每组重新跑门禁。

## 34.2 不允许

- 直接 merge 08/09/10 整分支；
- 直接 push `latest` / `v8-latest` 做候选；
- 未验收直接碰正式卷；
- 在正式 ECS 上反复全量构建；
- 清理当前 production image 回滚点；
- 因 GitHub Releases 页面没更新就误判代码没写。

## 34.3 候选镜像

使用固定 SHA tag：

```text
qiantie-platform:release-candidate-<sha>
```

必须记录完整 image digest。

## 34.4 Volume 演练

正式卷：只读 `:ro`。

流程：

```text
正式 volume
  ↓ :ro
新的临时 volume
  ↓
候选镜像执行 migration
  ↓
检查 backup / schema / quarantine / audit
  ↓
人工业务验收
```

不能复用已经迁移过的旧临时卷证明 schema1 → schema2 能力。

---

# 35. Codex 后续执行顺序（必须遵守）

当 Codex 读取本文件后，应按以下方式工作：

1. **先确认 production snapshot**，不要默认 master；
2. 把本文件当“需求/设计总表”，不是当“所有功能已经完成”的证明；
3. 对每个功能先找到其历史实现 branch；
4. 抽取功能，不直接 merge 整个历史 branch；
5. 在 production snapshot 上重建；
6. 保持 Go 正式 ownership 方向；
7. 每组功能单独测试；
8. 自动测试后做真实临时 volume 演练；
9. 人工业务验收；
10. 最后才切生产。

建议功能重建批次：

```text
A. 当前已验证 Batch Factory + Preset migration + Drawer
B. Batch V10 / 121 / Yadi 等后续能力
C. 小说获取增强
D. 剧本协同
E. 账户/团队（单独做数据迁移）
F. Pixiu / CM 等非 Batch 核心体验
```

账户/团队 01–05 是另一条完整历史线，不能为了 Batch Factory 一次 merge 进生产。

---

# 36. 文件快速索引

## 最终架构设计

```text
docs/superpowers/specs/2026-08-29-batch-factory-go-api-migration-design.md
```

## Go settings/config/director

```text
backend/internal/shuihuo/batchfactory/
backend/internal/httpapi/shuihuo_batch_factory_settings_handlers.go
backend/internal/httpapi/shuihuo_batch_factory_director_handlers.go
backend/internal/storage/migrations/028_batch_factory_settings.sql
```

## Node migration bridge

```text
lib/batch-factory/
routes/batch-factory.js
routes/batch-factory-settings-hydration.js
```

## React V10

```text
frontend/src/user/pages/BatchFactoryPageV10.jsx
frontend/src/user/pages/batch-factory/
frontend/src/shared/api/batchFactory.js
```

## Inline Constraint / Drawer UI 历史主参考

分支：

```text
10-batch-factory-inline-constraints-version-config
```

文件：

```text
frontend/src/user/pages/batch-factory/BatchConstraintSettings.jsx
frontend/src/user/pages/batch-factory/BatchFactorySettingsDrawers.jsx
frontend/src/user/pages/batch-factory/workspace-layout.js
```

## Preset migration

```text
lib/preset-store-migration.js
lib/preset-store-schema.js
scripts/verify-preset-volume-upgrade.sh
```

---

# 37. 最终产品定义检查表

只有下面项目都成立，才可以叫“正式完整批量工厂”：

- [ ] 小说获取可以稳定转入
- [ ] 不自动导演
- [ ] 原文直转
- [ ] 爆款开头 + Hook 审核
- [ ] 爆款强情绪
- [ ] 配置版本冻结
- [ ] 同步后台最新版本但不静默覆盖
- [ ] 视频模型由 Go catalog 权威验证
- [ ] 9:16 / 16:9
- [ ] 固定单 VIDEO
- [ ] 人物 / 场景 / 道具引用注入
- [ ] Prefix auto/manual
- [ ] Quality
- [ ] Restriction
- [ ] Negative
- [ ] Subtitle policy
- [ ] 约束开关打开直接编辑
- [ ] 系统预设 / 我的提示词 / 草稿
- [ ] Batch / Book / VIDEO 三级设置继承
- [ ] 显式 false/空字符串正确
- [ ] 恢复继承删除 override key
- [ ] 模型变化触发旧导演失效
- [ ] final prompt 与 preview 共用 compiler
- [ ] 单本生产
- [ ] 整批生产
- [ ] 历史批次兼容
- [ ] 状态/失败可见
- [ ] merge
- [ ] 发布统一设置版本化
- [ ] production snapshot 可复现
- [ ] Preset Store 可迁旧 volume
- [ ] 正式 Batch 主数据最终 Go-owned
- [ ] Node Batch Factory 业务逻辑最终删除/变纯代理

---

# 38. 给 Codex 的最短读取指令

后续可以直接告诉 Codex：

```text
请先读取：
docs/batch-factory/BATCH_FACTORY_COMPLETE_DESIGN_AND_BRANCH_MAP.md

分支：
docs/batch-factory-complete-spec-20260830

这份文件是 Batch Factory 产品需求、UI、架构、历史分支和发布基线总表。
不要直接 merge 08/09/10 历史分支；以 production snapshot 为正式发布基线，按文档逐组重建并验证。
```

---

# 39. 文档维护规则

以后任何 Batch Factory 设计变更必须同步更新本文件，并注明：

- 修改日期；
- 最终产品要求是否变化；
- 对应实现 branch；
- commit SHA；
- 是否已在 production snapshot 验证；
- 是否已经正式发布。

禁止只在聊天中改需求而不回写文档，否则后续 Codex 会再次出现“不同历史分支都是正确版本”的歧义。
