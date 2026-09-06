# V78.3.0.31 视频画面提示词工具：制作逻辑、提示词体系与公网复刻规范

> 日期：2026-09-06  
> 分析对象：`视频画面提示词工具_V78.3.0.31_统一风格字段边界误判根治_专业摄影参数兼容_20260904.zip`  
> 分析目标仓库：`cui1112233/-`  
> 分析记录分支：`v88`  
> 任务类型：源码调查 / 逆向梳理（Spike），本轮不改业务代码  
> 状态：已完成源码主链路调查；本文同时作为 OBJ 执行记录和后续公网实现依据。

---

## 0. 本次执行计划与实际执行状态

### 0.1 执行计划

- [x] 调用 Superpowers `using-superpowers` 与 `brainstorming`，确定本轮为源码调查，不直接改代码。
- [x] 解包 V78.3.0.31，确认前端、CharacterCore、Outline V3、Clean Core、后端 FastAPI 的真实文件位置。
- [x] 找出 UI 第 1～5 步的真实数据结构与调用关系。
- [x] 统计“提示词”在源码中的不同层级，避免把一个大系统误认为只有一条 prompt。
- [x] 找出 `DEFAULT_STYLE`、`DEFAULT_AI_INSTRUCTIONS`、运行时 Skill/Rule、后端 system prompt、动态 prompt builder。
- [x] 追踪“统一风格附加视觉信息”的完整生成、校验、修复、写回逻辑。
- [x] 追踪第三步、第四步的整段分镜生成链：导演要求契约 → Global Director Plan → 剧情批次 → 验收 → 必要时定向修复 → 原子写回。
- [x] 追踪第五步最终分段：确认是否再次调用 AI、如何按秒分段、如何拼接统一风格/统一人物/画面/负面/声音文字隔离/画质约束。
- [x] 追踪普通模式与精品模式的 Master Visual Prompt 关系。
- [x] 按源码逻辑整理成公网可直接使用的详细元提示词。
- [x] 明确标记：哪些是 V78.3.0.31 原有逻辑，哪些是为了公网架构整理出的推荐实现。

### 0.2 实际检查的关键源码

- `_internal/app/templates/index.html`
- `_internal/app/static/app.js`
- `_internal/app/static/character-core/character-core.js`
- `_internal/app/static/outline-v3/outline-v3.js`
- `_internal/app/static/clean-core/master-prompt.js`
- `_internal/app/static/clean-core/scene-context.js`
- `_internal/app/static/clean-core/generator-protocol.js`
- `_internal/app/static/clean-core/generator-service.js`
- `_internal/app/static/clean-core/outline-service.js`
- `_internal/app/main.py`
- `_internal/app/resources/cinematic_library_v3.json`

---

# 1. 最重要的结论

V78.3.0.31 **不是“一条系统提示词 → 直接输出所有视频提示词”**。

它实际上是一个分层导演系统：

```text
完整原文
  ↓
统一风格分析（独立）
  ↓
人物/场景/人工导演条件准备
  ↓
导演要求语义合同（AI）
  ↓
Global Director Plan（AI，只规划，不写最终镜头）
  ↓
按剧情 Scene / Event 自动划分语义批次
  ↓
批次执行导演（AI，生成每行完整视频画面 + 1~6 个 micro_shots）
  ↓
语义验收（AI）
  ↓ 若失败
只修失败原文行一次（AI）
  ↓
再次验收
  ↓
一次性原子写入第三步 + 第四步
  ↓
第五步本地按秒合并（0 次 AI）
  ↓
最终视频段提示词
```

其中有三个必须保留的设计思想：

1. **统一风格和具体镜头分权。** 统一风格只负责全片摄影/成像底子，不负责某一镜具体动作、具体灯位、具体焦段。
2. **一行原文 = 一张外层剧情卡。** 一张卡内部才允许 1～6 个 micro_shots，不能把 micro_shot 再当成新的原文卡。
3. **第五步绝对不是 AI 再总结一次。** 已确认的画面正文只能复制、换算相对时间、拼接固定头尾，不得再让模型改写，否则前面所有导演控制都会被破坏。

---

# 2. 它到底有多少“提示词”

“有多少提示词”必须按层级回答，因为源码里同时存在可配置 prompt、系统 prompt、Skill、Rule、协议 prompt 和动态拼装 prompt。

## 2.1 用户可编辑 AI 指令：8 组

`DEFAULT_AI_INSTRUCTIONS` 固定有 8 个入口：

1. `global`：全局 AI 指令
2. `analysis`：内容类型 / 统一风格分析
3. `genre`：内容类型优化
4. `visual_style`：统一视觉风格优化
5. `single_character`：单人物卡优化
6. `all_characters`：全部人物卡优化
7. `outline`：整段分镜
8. `scene_regenerate`：单条分镜定向改稿

这 8 组不是最终输出，而是会被不同功能动态嵌入系统 prompt。

## 2.2 默认风格 / 最终导出字段：7 个

`DEFAULT_STYLE` 中有：

1. `genre`：内容类型
2. `trailer_style`：统一风格附加视觉信息
3. `camera`：最终视频画面格式 / 结构要求
4. `negative_prompt`：最终导出负面提示词
5. `picture_limit_prompt`：声音与文字隔离
6. `quality_constraint_prompt`：最终导出画质约束
7. `remark_prompt`：最终输出首行提示

注意：`negative_prompt`、`picture_limit_prompt`、`quality_constraint_prompt` **明确不参与 AI 拆镜**，只在第五步每个最终视频段末尾追加一次。

## 2.3 “统一风格附加视觉信息”内部不是一段随便的文字，而是 11 个组件

`STYLE_COMPONENT_FIELDS_V78`：

1. `cinematic_quality` → 影视质感
2. `capture_texture` → 实拍质感
3. `grain_texture` → 颗粒纹理
4. `filter_tone` → 滤镜 / 色彩科学
5. `lens_language` → 镜头体系
6. `optical_texture` → 光学纹理
7. `contrast_level` → 对比度
8. `saturation_level` → 饱和度
9. `lighting_layers` → 光线层次
10. `narrative_composition` → 叙事构图
11. `atmosphere` → 氛围感

程序最后按固定顺序把这 11 项用中文逗号连接，得到 `trailer_style`。

## 2.4 运行时 Skill / Rule 不是 8 条，而是几十条

对 `app.js` 做静态扫描：

- 广义的 Prompt / Rule / Skill / Instruction 风格常量名：约 79 个。
- 其中直接以模板字符串保存、可以确认是正文规则块的：`app.js` 中 64 个。
- `clean-core/reference-entities.js` 另有 `PERFORMANCE_RULES`。
- 另外还有大量通过函数动态构建的 prompt。按函数名广义扫描，Prompt / Instruction / Rule / Contract 相关 builder / helper 超过 160 个；它们并不都会在一次请求中同时发送。

因此不能说“系统只有 8 条提示词”。8 条只是 **AI 指令中心的可编辑入口**。

### 2.4.1 与分镜直接相关的核心规则块

源码中可以明确看到：

- `DIRECTOR_MUST_COVER_RULES`
- `DIRECTOR_RHYTHM_RULES`
- `SHOT_SIZE_AND_MOVEMENT_EXECUTION_SKILL_V21`
- `FAST_OUTLINE_MUST_COVER_RULES`
- `FAST_OUTLINE_RHYTHM_RULES`
- `SCENE_AND_SUBSCENE_SKILL`
- `LINE_BASED_STORYBOARD_SKILL`
- `DIALOGUE_DEDUP_SKILL`
- `VISUAL_SAFETY_REPHRASE_SKILL`
- `DIRECTOR_ENHANCEMENT_SKILLS`
- `COMPLETE_VISUAL_BODY_SKILL`
- `WHOLE_OUTLINE_CINEMATIC_SKILLS`
- `SOURCE_TO_VISUAL_REASONING_SKILL`
- `COMPLEX_SOURCE_REASONING_SKILL`
- `PROFESSIONAL_VISUAL_STYLE_SKILL`
- `ADVANCED_CAMERA_MOVEMENT_SKILL`
- `SCENE_REGENERATION_VISUAL_SKILL`
- `DIRECTOR_ENHANCEMENT_SKILLS_FAST`
- `WHOLE_OUTLINE_CINEMATIC_SKILLS_FAST`
- `USER_GUIDANCE_PRIORITY_SKILL`
- `PROMPT_FLUENCY_SKILL`
- `ADVANCED_SHOT_SIZE_DESIGN_SKILL_V37`
- `V7826_CINEMATIC_LANGUAGE_EVOLUTION_SKILL`
- `V7827_SCENE_STYLE_AUTHORITY_RULE`
- `UNIVERSAL_STORYBOARD_STANDARDIZATION_SKILL_V36`
- `V783_TEMPORARY_DYNAMIC_TEXT_RULE`
- `V7824_BLOCKING_VISUAL_DENSITY_RULE`
- `V7830_MULTI_CUT_STORYTELLING_RULE`（动态/兼容层中存在）
- `V783015_CONCRETE_VIDEO_BODY_RULE`
- `V78305_NARRATIVE_FOCUS_OUTPUT_RULE`
- `V783018_SUBJECT_EXPLICIT_SHOT_SIZE_RULE`
- `V783017_CONTINUITY_STATE_MACHINE_RULE`
- `V783017_ACTION_MATCH_CUT_RULE`
- `V783017_SEMANTIC_DIALOGUE_CUT_RULE`
- `V78302_SCENE_EVENT_OWNERSHIP_RULE`

### 2.4.2 人物分析 / 人物卡相关规则块

还包括：

- `UNIVERSAL_CHARACTER_RECOGNITION_SKILL`
- `UNIVERSAL_CHARACTER_RECOGNITION_SKILL_FAST`
- `UNIVERSAL_CHARACTER_STAGE_CARD_SKILL_V37`
- `UNIVERSAL_SCENE_ENTITY_LAYERING_SKILL_V37`
- `UNIVERSAL_CHARACTER_LOGIC_SKILL_V38`
- `UNIVERSAL_EVIDENCE_DRIVEN_APPEARANCE_SKILL_V39`
- `UNIVERSAL_CHARACTER_ANALYSIS_INSTRUCTION_V39`
- `UNIVERSAL_SINGLE_CHARACTER_INSTRUCTION_V39`
- `UNIVERSAL_ALL_CHARACTERS_INSTRUCTION_V39`
- `V44_UNIVERSAL_EVIDENCE_APPEARANCE_SKILL`
- `V44_SINGLE_CHARACTER_INSTRUCTION`
- `V44_ALL_CHARACTERS_INSTRUCTION`
- `V45_UNIVERSAL_CHARACTER_VISUAL_CONSTRUCTION_SKILL`
- `V45_SINGLE_CHARACTER_INSTRUCTION`
- `V45_ALL_CHARACTERS_INSTRUCTION`
- `V47_UNIVERSAL_PURE_APPEARANCE_SKILL`
- `V47_SINGLE_CHARACTER_INSTRUCTION`
- `V47_ALL_CHARACTERS_INSTRUCTION`
- `V48_WARDROBE_CONTRACT_SKILL`
- `V48_SINGLE_CHARACTER_INSTRUCTION`
- `V48_ALL_CHARACTERS_INSTRUCTION`
- `V49_UNIVERSAL_IDENTITY_SKILL`
- `V52_UNIVERSAL_RELATIONSHIP_GRAPH_SKILL`
- `V23_TEMP_SKILL`
- `V23_SCENE_SKILL`
- `V23_SHOT_SKILL`
- `V23_DIALOGUE_SKILL`
- `V23_SOURCE_SKILL`

结论：**它不是靠某一个“神 prompt”，而是靠多层规则叠加 + 后端协议校验 + 失败定向修复。**

---

# 3. 后端真正参与第三、第四步的 9 类系统元提示词

`main.py` 中 Outline V3 的核心 system prompt builder：

1. `_outline_v3_director_plan_system_prompt`  
   全局导演规划，不写最终镜头。
2. `_outline_v3_batch_system_prompt`  
   批次执行，真正生成完整画面和 micro_shots。
3. `_outline_v3_system_prompt`  
   单条 Patch Regenerate。
4. `_outline_v3_protocol_repair_system_prompt`  
   只修 JSON / 枚举 / 时间协议，不重新创作剧情。
5. `_outline_v3_constraint_contract_system_prompt`  
   把用户自由输入的“必须拍出、镜头节奏、单卡意见、场景推进”编译成机器可验收的语义合同。
6. `_outline_v3_constraint_audit_system_prompt`  
   对最终画面逐项语义验收。
7. `_outline_v3_constraint_repair_system_prompt`  
   只修验收失败的原文行，且不改总时长。
8. `_outline_v3_story_map_system_prompt`  
   超长原文时建立 Scene Story Map。
9. `_outline_v3_story_synthesis_system_prompt`  
   更长文本时再把 Story Map 汇总为全剧 arc / continuity 总览。

这 9 类 system prompt 加上浏览器端拼入的 AI 指令中心、人物/场景快照、统一风格、用户人工要求，才组成真实发送给模型的请求。

---

# 4. “统一风格附加视觉信息”的真实制作逻辑

这是本次最需要复制到公网的部分。

## 4.1 它不是镜头 prompt

`统一风格附加视觉信息` 的职责只有一个：

> 建立整部视频共用的 **专业摄影 / 成像基线**。

它不负责：

- 某一镜人物做什么；
- 某一镜站哪里；
- 某一镜具体是 35mm 还是 85mm；
- 某一镜用窗光还是顶灯；
- 某一镜推、拉、摇、移；
- 某一镜具体构图；
- 人物外形；
- 负面提示词；
- 声音文字隔离；
- 最终画质约束。

所以公网的 **“画面前缀词 → 智能统一规则”** 应该对应这一层，而不是把完整分镜导演 prompt 塞进画面前缀。

## 4.2 它的优先级

源码明确使用：

```text
原文明示事实
>
当前字段专属修改意见
>
统一风格判断建议
>
AI 指令中心当前功能指令
>
内置类型库 / 视觉参考库
```

这意味着用户写“暖色、不要暗角、增加颗粒、降低对比、不要固定 ARRI”等时，系统必须真实改变最终统一风格，而不能只回复“已参考”。

## 4.3 它先分析剧情，再决定摄影

内部顺序：

```text
时代 / 世界观
→ 主角核心目标
→ 核心关系
→ 核心冲突
→ 持续叙事发动机
→ 主要剧情钩子
→ 整体情绪曲线
→ 观看期待
→ 内容类型
→ 11 项统一视觉组件
```

因此它不会因为剧本里出现“医院、死亡、背叛、系统、争吵”就机械变成冷灰悬疑风。

## 4.4 11 项字段的职责边界

### cinematic_quality
主摄影机 / 整体影像底子，例如 Camera Body、整体数字或胶片方向。

### capture_texture
Sensor Format、Open Gate、采集解析度倾向、Log/Gamut/Color Pipeline、动态范围、FPS/Shutter、EI/ISO/ND 等采集层。

### grain_texture
Film Stock / 数字纹理 / Grain 强度。

### filter_tone
综合色彩科学、WB、Print Emulation、主辅色。

### lens_language
统一 Lens Family、主焦段体系、T-stop 范围。

### optical_texture
Diffusion、Black Pro-Mist / Glimmerglass、Bloom / Halation、Bokeh、Focus Fall-off、数字锐化、Vignette。

### contrast_level
动态范围、Black Level、Highlight Roll-off、总体反差。

### saturation_level
总体饱和与 Selective Saturation。

### lighting_layers
Skin EV、Key:Fill、Motivated Light、轮廓分离。

### narrative_composition
9:16 前中后景、人物关系构图、整体 Camera Movement Texture。

### atmosphere
空气感、湿度、雾层、材质反射、整体情绪气质。

## 4.5 V78.3.0.31 的关键修复

这版专门修了“摄影边界被误判为负面提示词”的问题。

以下内容 **允许出现在统一风格字段**：

- 无明显暗角；
- 避免高光死白；
- 不压黑暗部；
- 低数字锐化；
- 控制粗颗粒；
- Bloom/Halation 控制；
- Vignette 接近 0。

这些是摄影/成像控制，不是最终 `negative_prompt`。

真正禁止混入统一风格的，是：

- 水印；
- 字幕；
- Logo；
- 最终导出负面提示词；
- 声音文字隔离；
- 最终画质尾词；
- 人物外形要求。

---

# 5. 公网可直接采用的元提示词 ①：智能统一规则

> 用途：公网剧本生成 → 约束设置 → 画面前缀词 → `智能统一`。  
> 来源：按 V78.3.0.31 `buildStyleOnlyPrompt()` + `visual_style` 指令 + 11 项字段边界整理。  
> 推荐实现：AI 只返回 11 项结构化字段；Go 后端再按固定顺序拼成一个 `unified_visual_prefix`。不要要求 AI 同时再写一份聚合文本，避免两份结果不一致。

```text
你是“全片智能统一视觉风格规划器”。

你的任务不是写具体分镜，不是写某一镜的动作，不是生成角色卡，而是通读完整剧本后，为整部视频建立一套稳定、专业、可执行的统一视觉/摄影基线。

【输入】
完整剧本：
{{FULL_SCRIPT}}

已确认内容类型（若有）：
{{CONTENT_TYPE}}

统一风格判断建议（若有）：
{{GLOBAL_STYLE_ADVICE}}

风格附加视觉信息修改意见（若有）：
{{VISUAL_STYLE_ADVICE}}

【权威优先级】
原文明示事实 > 当前视觉字段专属修改意见 > 当前统一风格判断建议 > 系统当前视觉指令 > 内置视觉参考知识。
用户要求增加、删除、保留、强调、减弱、改冷暖、改颗粒、改反差、改镜头性格、改光影、改构图或改气氛时，必须实际反映到最终字段，不能只声称“已参考”。

【第一阶段：内部理解，禁止输出分析过程】
先判断：
1. 主要时代与跨时代例外；
2. 世界观与主要现实/幻想层；
3. 主角核心目标；
4. 核心人物关系；
5. 核心冲突；
6. 持续推动剧情的叙事发动机；
7. 主要剧情钩子；
8. 全剧主要情绪曲线；
9. 观众观看期待；
10. 最适合本片的视觉媒介与摄影基线。

禁止因为单独出现死亡、医院、背叛、事故、弹幕、系统、争吵、出轨等刺激词就机械套用冷灰、低饱和、高对比或悬疑摄影。

【统一风格总原则】
1. 统一风格描述的是“整部作品共用的成像底片”，不是某一镜头的现场调度。
2. 全片摄影基线统一，但不同 Scene 可以按照真实昼夜、地点、情绪和人物 Blocking 动态改变局部色温、光源、光比、局部色彩、镜头距离和现场机位。
3. 具体逐镜焦段、角度、运镜、人物动作、站位、现场光源由后续分镜导演决定，当前阶段不得锁死。
4. 不得固定套设备模板。ARRI ALEXA 35 / Mini LF、Sony VENICE 2 / FX3、RED V-RAPTOR、Canon Cinema EOS、Leica SL / Summilux、Apple iPhone Pro Cinematic 等只是知识候选，只有真正适合当前作品时才选择。
5. 现代题材不等于默认 iPhone；追求电影感不等于默认 ARRI；高级感也不等于必须 2383 + BPM 1/8 + 低饱和。
6. 专业数值只写真正改变最终画面观感的项目，禁止无意义堆 Codec、Bitrate、存储介质。
7. 长期底线：人物脸与眼神可读；真实皮肤、发丝、服装和环境材质；高光滚降柔和；暗部有细节；数字锐化克制；无粗糙 VHS 脏感；无来源不明的全画面 Bloom；不默认重暗角。
8. “无明显暗角、避免高光死白、不压黑暗部、低数字锐化、控制粗颗粒”等属于合法摄影边界，不属于负面提示词。
9. 禁止输出水印、字幕、Logo、人物外形、最终负面提示词、声音与文字隔离、最终画质尾词等跨字段内容。

【必须输出的 11 项视觉组件】

1. cinematic_quality
- 主 Camera Body / 整体影像底子。
- 说明整体是何种高端数字、胶片模拟或适配的高端移动影像体系。

2. capture_texture
- Sensor Format：Super35 / Large Format / Full Frame / VV 等；
- Open Gate / 采集解析度倾向；
- Log / Gamut / Color Pipeline；
- Dynamic Range；
- FPS / Shutter；
- EI / ISO / 必要 ND；
- 若确实适配高端移动或 Leica 影像，可在此体现。

3. grain_texture
- Film Stock 或数字纹理方法；
- Grain 类型、粒度和强度；
- 不用粗颗粒制造所谓“电影感”。

4. filter_tone
- Color Science；
- WB 基线；
- Print Emulation（如适合）；
- 全片主色、辅助色及综合色彩关系。

5. lens_language
- 统一 Lens Family；
- 主焦段体系，例如 24/35/50/75/85mm 中真正适合本片的组合；
- T-stop 使用范围；
- 不锁死每一镜实际焦段。

6. optical_texture
- Spherical / Anamorphic；
- Black Pro-Mist / Glimmerglass 等 Diffusion（如需要）；
- Bokeh；
- Bloom / Halation；
- Flare；
- Focus Fall-off / Breathing；
- Sharpen；
- Vignette。

7. contrast_level
- Dynamic Range；
- Black Level；
- Highlight Roll-off；
- 全片基础反差策略。

8. saturation_level
- 总体 Saturation；
- Selective Saturation；
- 人物肤色与环境色的控制关系。

9. lighting_layers
- Skin Exposure / Skin EV；
- Key:Fill 基线；
- Motivated Light 原则；
- 人物与背景的轮廓分离；
- 这里只写全片原则，不写某一场景固定灯位。

10. narrative_composition
- 9:16 竖屏前景 / 中景 / 后景纵深；
- 人物关系构图；
- 空间层级；
- 全片 Camera Movement Texture；
- 具体每镜运动仍交给分镜导演。

11. atmosphere
- 空气感；
- 湿度 / 雾层；
- 材质反射；
- 环境质感；
- 全片主要情绪气氛。

【输出协议】
只返回合法 JSON，不要 Markdown，不要解释，不要候选方案，不要输出思考过程。

固定格式：
{
  "cinematic_quality":"...",
  "capture_texture":"...",
  "grain_texture":"...",
  "filter_tone":"...",
  "lens_language":"...",
  "optical_texture":"...",
  "contrast_level":"...",
  "saturation_level":"...",
  "lighting_layers":"...",
  "narrative_composition":"...",
  "atmosphere":"..."
}

每项都必须非空、专业、可执行，但不要无意义堆参数。
```

### 5.1 公网后端拼接规则

```text
unified_visual_prefix =
cinematic_quality
+ "，" + capture_texture
+ "，" + grain_texture
+ "，" + filter_tone
+ "，" + lens_language
+ "，" + optical_texture
+ "，" + contrast_level
+ "，" + saturation_level
+ "，" + lighting_layers
+ "，" + narrative_composition
+ "，" + atmosphere
```

如果最终视频 prompt 需要显示类型：

```text
统一风格：{content_type}，{unified_visual_prefix}
```

公网“画面前缀词”的 `智能统一` 最好保存 `unified_visual_prefix`，而不是把某一镜头画面写进去。

---

# 6. 第三步、第四步其实不是两次独立 AI 重写

这是源码里一个非常重要的结构。

第三步 UI：**原文分镜与对应时间片**。  
第四步 UI：**AI 返回的总时间轴画面库**。

它们来自同一次 Outline V3 原子事务：

```text
AI 返回 rows
↓
v3RowsToOutlineShots()
↓
v3BuildCandidate()
↓
同时构造 candidate.scenes + candidate.outline_shots
↓
一次性：
state.scenes = candidate.scenes
state.outlineShots = candidate.outline_shots
↓
renderScenes()
renderOutputs()
```

因此：

> **不要在公网实现成：第三步 AI 生成一次 → 第四步再让 AI 把第三步重写一次。**

这样会造成剧情、秒数、人物、动作和连续性漂移。

正确做法是：第三步和第四步只是同一份权威数据的不同视图。

---

# 7. 第三步前置：导演要求先编译成“语义合同”

V78.3.0.31 在正式写镜头前，会先把：

- 必须拍出的原文细节；
- 镜头节奏与推进要求；
- 每条分镜自己的补充意见；
- 原文真实需要的换场 / 时间 / 事件推进；

编译成 4 组结构化合同：

```json
{
  "must_cover": [],
  "rhythm": [],
  "row_guidance": [],
  "scene_progression": []
}
```

每项包含：

```text
id
requirement
source_indices
applies_to_all_rows
pass_condition
```

目的不是“把关键词塞进 prompt”，而是最后可以逐条验收“实际画面有没有做到”。

公网复刻时建议保留这一层，因为它是防止“模型回复看似听懂了，但画面没落实”的关键。

---

# 8. 公网可直接采用的元提示词 ②：第三步 Global Director Plan

> 这是“剧本提示词”的第一半。  
> 只做全剧导演规划，**不直接输出最终画面正文**。

```text
你是“全局剧情导演与剪辑规划器”。

你的第一职责不是逐句翻译原文，而是先把每一行原文理解成：
“这一小段视频真正应该演什么、为什么这样拍、需要多少秒、内部需要几个真实微镜头、从上一行如何接过来、最后落在哪里。”

任何最终镜头正文都必须等本次 Global Director Plan 完成后再生成。

【输入】
完整剧本：{{FULL_SCRIPT}}
逐行原文：{{SOURCE_ROWS}}
统一风格：{{UNIFIED_STYLE}}
正式人物卡：{{CHARACTERS}}
导演要求语义合同：{{DIRECTOR_CONSTRAINT_CONTRACT}}
参考音频时长：{{AUDIO_REFERENCE_SECONDS}}
参考节奏资料：{{REFERENCE_VIDEO_PROFILE}}

【最高规则】
1. 每个非空原文行必须且只能对应一个外层剧情段。
2. 外层段内部允许 1～6 个 micro_shots；micro_shots 不是新的原文卡。
3. 先做剧情语义，再做摄影规划。
4. 总结、概括、时间跨度、身份关系、评价态度、回忆补叙必须主动剧情化，不能让人物坐着、站着、发呆听旁白。
5. 允许根据原文明示关系、全文上下文和语义必然结果补足不改变因果的生活化过渡、代表性低风险行为、时间压缩、人物微反应和空间动作。
6. 禁止新增对白、重大身份、关键证据、伤害/死亡结果、恋爱事实、不可逆行为、会影响后文因果的新道具，也不得提前完整拍完下一行明确事件。

【每行先判断 narrative_type】
只能从以下选择一个：
- 直接动作
- 对白互动
- 情绪反应
- 总结概括
- 身份关系揭示
- 反转揭示
- 回忆补叙
- 评价态度
- 信息载体

【micro_shot_count】
- 瞬时信息 / 简单反应：通常 1～2
- 普通动作 / 普通关系推进：通常 2～3
- 总结概括 / 时间跨度 / 回忆 / 反转 / 高信息密度：通常 3～5
- 只有复杂且确实能拍时才使用 6

镜头数量不是目标；完整表达、不拥挤、不重复才是目标。

【duration】
由你按 micro_shot_count、动作复杂度、声音与情绪落点判断自然的正整数秒。
不要按字数、标点或平均分配时间。
短信息镜可以快；人物关系、真实对白、复杂动作和关键情绪需要时可以自然停留。

【剧情可视化】
每行必须形成：Narrative Beat → Visual Beat。
说话人不一定永远是镜头主体：
- 信息作用到听者时可以规划 Reaction Shot；
- 人物看向某人/某物时可用 Eye-line Match；
- 抬手、转头、起身、推门、靠近、递物等可用 Cut on Action；
- 原文明示关键物件可用 Object-motivated Cut；
- 连续近景后可安排 Spatial Reset；
- 真正重要人物出场可用 Reveal，但不得滥用。

【Shot Signature】
每行规划一个外层主导签名，用于跨行防审美疲劳：
- shot_size
- subject
- view_angle
- camera_height
- movement
- composition_type
- spatial_scale
- lighting_key

相邻行防疲劳不能只换焦段，要同时检查：景别、观察角度、主体、镜头功能、主运镜、光影 / 构图。
连续同一人物正面中景 + 平视 + 慢推，即使焦段改变也仍视为重复。

【光影分权】
统一风格负责 Camera / Sensor / Lens Family / T-stop 范围 / Film / Print / Diffusion / Grain / WB / Exposure / Light Ratio / Bloom / Halation 等全片基线。
当前 Director Plan 只决定每行的真实场景、关系、主要光线方向与叙事用途，不把整套统一风格复制到每个微镜头。

【batches】
按真实 Scene、地点、时间层、主要事件完整性、人物阵列和上下文请求预算划分批次。
禁止机械每 N 行一批。
每个 batch 返回：
- batch_id
- start_index
- end_index
- scene_goal
- continuity_anchor

【返回协议】
只返回 JSON：
{
  "rows":[
    {
      "source_index":1,
      "duration":4,
      "shot_function":"人物互动",
      "visual_subject":"...",
      "director_intent":"...",
      "continuity_exit":"...",
      "story_conversion":{
        "narrative_type":"总结概括",
        "visual_facts":["..."],
        "implied_beats":["..."],
        "micro_shot_count":3,
        "pacing_curve":"前快后停",
        "montage_mode":true,
        "inference_level":"representative"
      },
      "shot_signature":{
        "shot_size":"...",
        "subject":"...",
        "view_angle":"...",
        "camera_height":"...",
        "movement":"...",
        "composition_type":"...",
        "spatial_scale":"...",
        "lighting_key":"..."
      }
    }
  ],
  "batches":[
    {
      "batch_id":1,
      "start_index":1,
      "end_index":4,
      "scene_goal":"...",
      "continuity_anchor":"..."
    }
  ]
}

不得输出最终完整画面正文，不得输出 JSON 外文字。
```

---

# 9. 它怎么“分批”而不是机械分段

V78 的“AI 分段”和最终视频的“按秒分段”是两件完全不同的事。

## 9.1 AI 请求批次：按剧情语义 Scene 切

Global Director Plan 先给出 `batches`。

切批依据：

- 地点变化；
- 时间层变化；
- 现实 / 回忆变化；
- 人物阵列变化；
- 主要事件变化；
- 情绪段落变化；
- 语义完整性。

**不是每 5 行 / 10 行固定切。**

## 9.2 再按模型 Context Window 做“传输层切分”

如果一个语义 batch 的真实序列化请求超过当前模型上下文：

- 软件先尝试缩成 `hierarchical_story_context`；
- 如果仍过大，就把同一个语义 batch 切成 transport children；
- 如果单独一行完整请求仍然超 Context，则直接停止，不静默删字段。

这是非常好的设计，公网应该照搬思想：

> **语义批次由导演决定；传输批次只负责模型上下文安全，不能改变剧情分组。**

## 9.3 超长剧本使用 Story Map

长文本时先生成：

```text
Story Map
→ Scene 范围 / scene_goal / continuity_anchor / emotional_arc / visual_strategy
→ 全剧 arcs / continuity_global
→ 再做详细 Director Plan
```

这样可以避免每个 batch 都重复塞整篇长小说。

---

# 10. 公网可直接采用的元提示词 ③：第四步“每条完整视频画面提示词”生成器

> 这是用户要求的“最终分段提示词的元提示词 / 剧本提示词”的核心生成层。  
> 源码对应 `_outline_v3_batch_system_prompt()`。  
> 输入必须包含第三步 Global Director Plan，而不是直接裸剧本生成。

```text
你是“剧情执行导演、摄影指导与剪辑师”。

Global Director Plan 已经先把每一行原文转换成剧情意图、自然时长、微镜头数量、节奏和跨行连续性。
你的任务是严格按照 Director Plan，把当前剧情批次写成真正可以直接生成视频的完整结构化画面。

【输入】
当前剧情批次：{{CURRENT_ROWS}}
Global Director Plan：{{DIRECTOR_PLAN_ROWS}}
完整剧本或分层 Story Context：{{GLOBAL_STORY_CONTEXT}}
统一风格：{{UNIFIED_STYLE}}
正式人物卡：{{CHARACTERS}}
上一批结束状态：{{PREVIOUS_CONTEXT}}
下一行简要预览：{{NEXT_SOURCE_PREVIEW}}
导演要求语义合同：{{DIRECTOR_CONSTRAINT_CONTRACT}}
近期实际镜头防疲劳反馈：{{LIVE_FATIGUE_FEEDBACK}}

【一行一卡硬规则】
1. 当前批次每个 source_index 必须返回且只返回 1 个外层 segment。
2. 禁止合并两行原文。
3. 禁止把 micro_shot 输出成新的原文卡。
4. segment.duration 必须严格等于对应 Director Plan 的 duration。

【segment 必须包含】
- duration
- theme
- visual_context
- composition
- performance
- micro_shots
- audio（可选）

performance 只是整段“可见动作 / 结果”的简洁保底摘要。
真正完整的摄影、动作、表演和光影必须写在 micro_shots 中，禁止用 performance 代替 micro_shots。

【micro_shots】
数量原则上等于 Director Plan 的 micro_shot_count，允许因真实可拍性 ±1，但总数只能 1～6。

每个 micro_shot 必须包含：
- index
- start
- end
- rhythm
- speed_treatment
- shot_task
- shot_size
- view_angle
- movement
- lighting
- visual

【时间硬规则】
1. 第一个 micro_shot.start = 0。
2. 相邻 micro_shot 必须首尾连续。
3. 不得留空档。
4. 不得重叠。
5. 最后一个 micro_shot.end = segment.duration。
6. 每个微镜头都必须有真实可读的停留时间，禁止 0.1 秒级碎切。
7. 如果内容拍不下，优先减少微镜头或在上游 Director Plan 调整 duration；禁止靠极端倍速硬塞剧情。

【shot_task 只允许一个标准值】
- 空间建立
- 身份交代
- 关系建立
- 动作推进
- 情绪反应
- 道具信息
- 时间压缩
- 反转揭示
- 结果落点
- 转场承接

复合意图写进 visual，不要写成“关系建立与情绪反应”这种复合枚举。

【visual 写法】
visual 必须像真正的分镜导演稿，不是静态名词列表。
每个 micro_shot 都要回答：
1. 摄影机从哪里观察；
2. 当前视觉主体是谁 / 是什么；
3. 主体位于空间什么位置；
4. 人物 / 道具发生什么连续动作；
5. 另一个人物如何直接反应；
6. 背景同时发生什么必要变化；
7. 镜头因什么信息 / 动作 / 情绪节点结束。

允许合理补足：
- 布景；
- 站位；
- 生活化低风险动作；
- 微表情；
- 不改变剧情的代表行为；
- 时间压缩。

禁止新增：
- 新对白；
- 重大身份；
- 关键证据；
- 新伤害 / 死亡结果；
- 新恋爱事实；
- 不可逆重大行为；
- 后文依赖的新道具。

【总结 / 评价 / 时间跨度】
不能拍成“人物坐着叹气 + 旁白”。
应使用：
- 身份建立；
- 时间跳切；
- 压缩蒙太奇；
- 动作匹配；
- 代表性低风险行为；
- 人物关系动作；
- 直接反应落点。

【visual_context】
只描述真实物理空间、关键材质、前中后景与基础状态。
不要把完整摄影动作和整套统一风格塞进 visual_context。

【composition】
只写这一整个外层段的总体摄影 / 剪辑策略。
具体景别、机位、运镜、动作、光影全部写在 micro_shots。

【镜头语言】
1. 每个微镜头只选一个主运镜。
2. 主体已有强运动时摄影机应克制。
3. 景别必须带明确主体，例如：
   - 女主侧面中景
   - 男主过肩看女主近景
   - 手机屏幕与手指特写
   - 医院急诊入口建立中远景
   禁止只写“中景 / 近景 / 特写”。
4. 说话人不等于永远的镜头主体。
5. 根据剧情使用 Reaction Shot、Cut on Action、Eye-line Match、Object-motivated Cut、Spatial Reset、Reveal。
6. 保持 180° 轴线、人物方向、持物、动作结果和空间连续。
7. 根据近期镜头反馈避免连续同一人物正面、中景、平视、慢推，但叙事必须优先于形式变化。

【lighting】
每个 micro_shot 必须写真实动机光：
- 光源是什么；
- 从什么方向来；
- 主体脸 / 眼神如何保持可读；
- 发丝 / 肩线 / 服装如何自然分离；
- 背景暗部如何保持层次。

示例方向只能作为方法：窗光、顶灯、台灯、走廊灯、路灯、车灯、屏幕光、烛火、原文允许的能量光。
禁止只写“高级电影光影”。

统一风格中的 Camera / Sensor / Film / Print / Lens Family / Diffusion / Grain / WB 等不要在每个 micro_shot 重复抄一遍。

【速度】
rhythm 可写：快速建立、短促快切、时间压缩、前快后停、中速推进、正常速度情绪停留等。
speed_treatment 只有确有价值时填写。
真实口型对白、拥抱 / 摔倒等复杂身体接触、关键情绪反应禁止整体加速。

【audio】
audio 只负责声音，不负责把剧情“说出来代替画面”。
旁白 / 叙述的剧情事实必须已经在 micro_shots.visual 中可见。
不得编新对白。
需要时使用：
- lip_sync
- voiceover
- offscreen_voice
- ambient

【跨行连续性】
previous_context 用于承接：
- 人物位置；
- 朝向；
- 持物；
- 上一镜动作结果；
- 场景；
- 主光方向；
- 外层 Shot Signature。
next_source_preview 只用于避免当前镜抢拍下一行，不得提前完成下一行剧情。

【输出】
只返回 JSON：
{
  "rows":[
    {
      "source_index":1,
      "segments":[
        {
          "duration":4,
          "theme":"...",
          "visual_context":"...",
          "composition":"...",
          "performance":"...",
          "micro_shots":[
            {
              "index":1,
              "start":0,
              "end":1.2,
              "rhythm":"快速建立",
              "speed_treatment":"正常速度",
              "shot_task":"空间建立",
              "shot_size":"人物关系与空间建立中远景",
              "view_angle":"侧前平视",
              "movement":"稳定短跟后停住",
              "lighting":"...",
              "visual":"..."
            }
          ],
          "audio":{
            "mode":"voiceover",
            "speaker":"...",
            "text":"..."
          }
        }
      ],
      "temporary":[],
      "shot_signature":{
        "shot_size":"...",
        "subject":"...",
        "view_angle":"...",
        "camera_height":"...",
        "movement":"...",
        "composition_type":"...",
        "spatial_scale":"...",
        "lighting_key":"..."
      }
    }
  ]
}

禁止 JSON 外文字。
```

---

# 11. 第四步最终显示文本不是 AI 自由写格式，而是程序格式化

源码函数：`formatTimelineSegment()`。

固定输出：

```text
00:00-00:04 | 场景：具体空间/材质/纵深 | 画面：镜头1（约0.0-1.2秒，节奏：快速建立）：摄影+动作+光影；镜头2（约1.2-4.0秒，节奏：前快后停）：…… | 音轨（不可视觉化，仅声音）：……
```

`formatMicroShotBodyR8()` 会把每个 micro_shot 的：

```text
shot_size
view_angle
movement
visual
lighting
```

按固定顺序组装。

这意味着公网也应当：

> **让 AI 返回结构化 JSON，让 Go 后端负责最终文本格式。**

不要把“正确格式”完全交给模型自由发挥。

---

# 12. 第三 / 第四步的关键时间规则

当前 R8 后端校验：

- 外层 segment 最短：1 秒；
- 外层允许最大：120 秒；
- micro_shots：1～6；
- 每个 micro_shot 必须 > 0；
- 当前校验还要求单个 micro_shot 大约不能短于 0.28 秒；
- 第一镜从 0 开始；
- 连续覆盖到 duration；
- 不留空、不重叠；
- 整段生成时 duration 由 Global Director Plan 决定；
- 单条 Patch Regenerate 在旧卡存在时默认锁总时长，并且在未要求重新拆镜时锁原 micro_shot 时间槽。

注意：**这个 V78.3.0.31 的整段生成把 audio_total_seconds 当节奏参考，不是“最终总时长必须严格等于音频”。**

它的后端返回明确写的是：

```text
duration_authority = ai_global_director_plan
configured_hard_upper_seconds = 0
```

因此如果公网剧本生成已经有 `matchAudio=true → 必须严格等于 audioDurationSec` 的规则，不能把 V78 的“音频只作参考”原样复制过去。公网应当保留自己的硬音频约束，并只借用 V78 的导演/微镜头结构。

---

# 13. 语义验收：为什么它比“一次生成就算完”稳定

批次生成完后，V78 会让另一个语义验收器逐条检查：

- `must_cover`
- `rhythm`
- `row_guidance`
- `scene_progression`

每条要求返回：

```text
id
passed
evidence
missing
failed_source_indices
```

只有所有合同项都通过，`overall_passed=true`。

如果失败：

1. 只定位失败的 `source_index`；
2. 只重生这些失败行；
3. 不改原本正确的其它行；
4. 失败行总时长保持不变；
5. 修完再验收一次；
6. 第二次仍失败，则整轮不写入半成品。

这个机制值得公网保留。

---

# 14. 第五步的真实逻辑：0 次 AI，本地确定性合并

源码：

- `flattenOutlinePieces()`
- `outlineShotMergeUnits()`
- `buildLocalMergedSegments()`
- `buildLocalFinalSegmentText()`
- `mergeSegments()`

UI 文案也明确写：

> 已按当前最新画面卡合并为 N 段；**未请求 AI、未改写画面、未重新分配秒数。**

所以第五步不能再写成“请 AI 帮我把前面的分镜优化成最终提示词”。

## 14.1 第五步算法

### A. 建立全局绝对时间片

每张外层画面卡的局部 segment 转为：

```text
global_start = shot.start_second + segment.start_offset
global_end   = shot.start_second + segment.end_offset
```

按 `global_start` 排序。

### B. 先按外层原文卡分组

一张完整画面卡如果总时长 `<= maxSeconds`：

> 视为原子单位，禁止拆到两个最终视频段。

只有一张外层卡自身已经超过 `maxSeconds` 时，才允许尝试按卡内已有 timeline piece 边界拆。

注意：R8 正常是一行只有一个外层 timeline_segment，所以如果这张卡本身就是一个超长单段，并没有更细的 timeline piece 边界，本地合并不会为了满足 maxSeconds 去重新把 micro_shots 变成新的外层段。这个行为体现“保护已经确认的完整画面卡优先于机械卡死秒数”。

### C. 贪心装箱

从头按时间顺序放 unit：

```text
如果 proposedEnd - groupStart <= maxSeconds
    放进当前最终段
否则
    当前段 flush
    新建下一段
```

### D. 只重算最终段内相对时间

例如原全局时间：

```text
23s - 27s
27s - 31s
```

如果本最终段从 23s 开始，则最终展示：

```text
00:00-00:04
00:04-00:08
```

画面正文不改。

---

# 15. 第五步每个最终视频段的固定结构

源码 `buildLocalFinalSegmentText()`：

```text
首行提示
↓
统一风格
↓
统一人物
↓
镜头画面
↓
最终导出负面提示词
↓
声音与文字隔离
↓
最终导出画质约束
```

准确格式：

```text
{remark_prompt}
统一风格：{genre}，{trailer_style}
统一人物：{本段真正出现的人物 + 对应人物卡外形}
镜头画面：
00:00-00:04 | 场景：... | 画面：... | 音轨（不可视觉化，仅声音）：...
00:04-00:08 | 场景：... | 画面：... | 音轨（不可视觉化，仅声音）：...
【最终导出负面提示词】：...
【声音与文字隔离】：...
【最终导出画质约束】：...
```

三个尾部约束只追加一次，不参与前面的 AI 拆镜。

`统一人物` 也不是把全剧所有人物都塞进每个段，而是根据当前 `pieces` 的 `visible_characters / shot.characters / scene_characters` 计算本段实际人物。

---

# 16. 公网可直接采用的“第五步元提示词”——仅当暂时无法用 Go 本地拼装时使用

> **源码原本没有这次 AI 调用。**  
> 公网正确做法：用 Go 代码实现。  
> 以下 prompt 只是兼容方案；一旦后端可以本地组装，应删除这次模型请求。

```text
你是“最终视频段无损格式化器”，不是导演，不是编剧，不是画面优化器。

输入给你的画面卡全部已经通过导演生成和语义验收，是当前唯一权威画面正文。

你的唯一职责：
1. 按输入已有绝对时间和 max_segment_seconds 进行分组；
2. 保持完整外层画面卡优先；
3. 只把每个最终段的时间换算成从 00:00 开始的相对时间；
4. 拼接固定的首行提示、统一风格、本段统一人物和三个最终导出约束；
5. 原画面正文逐字保留。

【绝对禁止】
- 不得润色；
- 不得摘要；
- 不得扩写；
- 不得删除动作；
- 不得替换镜头；
- 不得重新分配原镜头秒数；
- 不得新增人物；
- 不得改变场景；
- 不得改变对白 / 旁白；
- 不得把负面提示词、声音文字隔离、画质约束混进镜头正文。

【输出每段固定顺序】
{remark_prompt}
统一风格：{content_type}，{unified_visual_prefix}
统一人物：{segment_characters}
镜头画面：
{retimed_existing_shot_lines_verbatim}
{negative_prompt}
{sound_text_isolation_prompt}
{quality_constraint_prompt}

只返回最终段数组，不输出解释。
```

再次强调：**这只是兼容 prompt，推荐 Go 本地函数完成。**

---

# 17. 普通模式与精品模式的 Master Visual Prompt

`clean-core/master-prompt.js` 的原则非常明确：

```text
premium_is_lossless_view_of_master
```

即：

- 普通模式已经生成的最高质量画面正文 = Master Visual Prompt；
- 精品模式不是再让 AI 重写一份更“高级”的正文；
- 精品模式只在 Master Prompt 上注入 `(@图N)` 参考索引；
- 注入后会检查动作、互动、道具、摄影和正文长度是否被破坏；
- 如果引用版本导致正文损失，会回退到 Master Prompt。

因此公网如果后面接人物参考图 / 场景参考图，也应采用：

> **先保存纯文本 Master Prompt → 参考图索引作为 export view → 永远不能反向覆盖 Master Prompt。**

---

# 18. “最终合成完整视频”应该怎么做

源码本身没有一个“把所有第五步段落重新丢给 AI，生成一条超长完整视频 prompt”的步骤。

`allEnhancedSegmentText()` 做的是：

```text
segment1

segment2

segment3
```

即把已完成的最终段按顺序连接文本，**不是重新创作**。

真正生成视频时，更安全的工作流应是：

```text
最终 Segment 1 Prompt → 视频模型 → clip_001
最终 Segment 2 Prompt → 视频模型 → clip_002
最终 Segment 3 Prompt → 视频模型 → clip_003
...
↓
按 source_start / index 顺序合成视频
```

而不是让 LLM 再写一个 mega prompt。

---

# 19. 公网新增建议元提示词 ④：最终完整视频任务编排器

> **这不是 V78 原有的一次 AI prompt，而是根据其 Master Prompt / 最终段保护原则，为公网整理出的编排层。**  
> 作用：如果公网需要一个“完整视频任务对象”，只组织任务，不修改任一最终段正文。

```text
你是“完整视频生成任务编排器”。

输入是一组已经最终确认的视频 Segment Prompt。
这些 Segment Prompt 是唯一权威正文，已经包含：统一风格、统一人物、镜头画面、音轨、负面提示词、声音文字隔离和画质约束。

你的职责不是重新写 prompt，而是把它们组织成按顺序执行的视频生成任务。

【硬规则】
1. 每个 segment_prompt 必须逐字保留，禁止摘要、润色、压缩、扩写或重新生成。
2. 不得把多个 segment 合并成一条新的长 prompt。
3. 不得改变 segment 的顺序、时长和镜头内容。
4. continuity 只记录跨段状态，不得反向改写已经确认的 segment_prompt。
5. 每一段生成完成后，把实际输出 clip 与 segment_index 绑定。
6. 最终合成严格按 segment_index / source_start 排序。
7. 如果某一段失败，只重试当前段，不重新生成其它已成功段。

【输入】
{
  "segments":[
    {
      "segment_index":1,
      "source_start":0,
      "source_end":10,
      "prompt":"最终确认的完整段提示词"
    }
  ]
}

【输出】
只返回 JSON：
{
  "generation_tasks":[
    {
      "task_index":1,
      "segment_index":1,
      "prompt":"逐字保留原 segment prompt",
      "depends_on":[],
      "continuity_in":{},
      "continuity_out_expected":{}
    }
  ],
  "assembly_order":[1,2,3],
  "assembly_rule":"按顺序无损拼接视频段；不对已生成镜头做AI重写"
}
```

如果我们在 Go 后端直接编排任务，这个元提示词也不需要真的调用 AI，直接用代码生成任务对象更可靠。

---

# 20. 推荐公网最终架构（对应第三、第四、第五步骤）

```text
A. 智能统一风格
完整剧本
→ SmartUnifiedStyle AI
→ 11 个结构化视觉字段
→ Go 拼接 unified_visual_prefix

B. 第三步：导演规划
完整原文 + 人物 + 风格 + 人工要求
→ Director Constraint Contract
→ Global Director Plan
→ 一行一个导演计划 + semantic batches

C. 第四步：完整画面生成
Director Plan + 当前 semantic batch + previous_context
→ Batch Shot Generator
→ 每行 1 个 outer segment
→ 每段 1~6 micro_shots
→ Semantic Audit
→ 必要时只修失败行一次
→ Go 原子写入 Scene View + Timeline View

D. 第五步：最终视频段
权威 Timeline View
→ Go 本地 flatten
→ 按外层卡原子性 + maxSeconds 贪心合并
→ 相对时间换算
→ 拼接统一风格 / 本段人物 / 固定尾约束
→ 0 次 AI

E. 视频生成与完整合成
每个最终 Segment Prompt 独立发给视频模型
→ 单段失败只重试单段
→ 按 index 拼接所有 clip
```

---

# 21. 公网系统里建议保存的数据，而不是只保存大字符串

为了后面可改、可验收、可重生，至少应该保存：

```json
{
  "style": {
    "content_type":"",
    "components": {
      "cinematic_quality":"",
      "capture_texture":"",
      "grain_texture":"",
      "filter_tone":"",
      "lens_language":"",
      "optical_texture":"",
      "contrast_level":"",
      "saturation_level":"",
      "lighting_layers":"",
      "narrative_composition":"",
      "atmosphere":""
    },
    "unified_visual_prefix":""
  },
  "director_plan": [],
  "storyboard_rows": [],
  "final_segments": [],
  "final_export_constraints": {
    "negative_prompt":"",
    "sound_text_isolation":"",
    "quality_constraint":""
  }
}
```

这样用户在约束设置里切换“智能统一 / 真人实拍 / 2D 动漫 / 3D 国漫”等预设时，可以只替换 style 层，而不是污染每一条镜头 JSON。

---

# 22. 公网“画面前缀词”建议的职责边界

对于截图中的：

```text
画面前缀词
- 系统预设
  - 2D动漫
  - 3D国漫
  - 国漫
  - 真人实拍
  - 智能统一
- 我的提示词
```

建议：

### 固定预设
2D / 3D / 国漫 / 真人实拍可以直接是后台保存的固定风格模板。

### 智能统一
不是固定模板，而是：

```text
完整剧本
→ 调用“智能统一规则”元提示词
→ 生成当前项目专属 11 项视觉组件
→ 拼成当前项目专属画面前缀
```

### 我的提示词
用户人工输入，直接作为用户最高优先级的视觉 style override；不要把它自动扩散成人物、剧情或最终负面约束。

---

# 23. 哪些逻辑必须由代码做，不能继续堆 Prompt

推荐必须由 Go 后端实现：

1. 一行原文 ID / source_index 稳定绑定；
2. JSON schema 校验；
3. micro_shot 数量 1～6；
4. micro_shot 时间连续性；
5. duration 与 Director Plan 一致；
6. 第三步 / 第四步原子写回；
7. stale request / revision 检查；
8. 第五步按秒合并；
9. 最终段相对时间换算；
10. 固定头尾拼接；
11. Segment Master Prompt 保存；
12. 参考图索引注入不能覆盖 Master Prompt；
13. 单段失败重试而不是全剧重跑。

推荐由 AI 负责：

1. 时代 / 世界 / 类型语义判断；
2. 统一视觉风格选择；
3. 人工导演要求语义合同；
4. Global Director Plan；
5. Narrative Beat → Visual Beat；
6. micro_shot 的真实导演表达；
7. 语义验收；
8. 失败行定向修复。

这就是 V78 稳定的核心：**AI 做语义和创作，代码做协议、身份、时间、版本、拼装和不可变约束。**

---

# 24. 源码现有逻辑 vs 本文公网补强建议

## 24.1 源码明确存在

- 11 项统一风格视觉组件；
- 独立 `buildStyleOnlyPrompt()`；
- 原文事实 / 用户字段意见的优先级；
- 风格字段边界校验；
- 一次风格修复；
- 8 组 AI 指令中心；
- Director Constraint Contract；
- Global Director Plan；
- semantic batches；
- 超长上下文 Story Map；
- 每行 1 outer segment；
- 1～6 micro_shots；
- 结构化微镜头字段；
- semantic audit；
- 失败行定向修复一次；
- 第三 / 第四步一次原子写回；
- 第五步 0 AI 本地合并；
- 固定最终 prompt 顺序；
- Master Visual Prompt；
- 精品参考图无损注入。

## 24.2 本文为了公网整理 / 新增

- 把 `统一风格附加视觉信息` 明确映射到公网 `画面前缀词 → 智能统一`；
- 将源码 Style Prompt 重写成一份后台可维护的独立系统元提示词；
- 将 Director Plan / Batch Generator 整理成公网可直接保存的元提示词模板；
- 提供“第五步 AI 格式化器”仅作为临时兼容方案，源码本身推荐 0 AI；
- 提供“最终完整视频任务编排器”作为公网下游任务层，源码本身没有再让 AI 重写所有最终段。

---

# 25. 最终实施优先级

后面如果开始把这套逻辑真正落进 V88 公网，推荐顺序：

1. **先落“智能统一规则”**，把现在 `智能统一` 从固定词升级为按整部剧本生成的项目视觉基线。
2. 再落 **Global Director Plan**，不要直接让一个 prompt 一步吐最终所有镜头。
3. 再落 **Batch Shot Generator**，实现一行一卡 + 1～6 micro_shots。
4. 再落 **语义合同与验收**。
5. 第五步直接用 **Go 本地确定性合并**，不要调用大模型。
6. 最后把每个 Segment Prompt 发给视频生成器，并按段合成完整视频。

---

# 26. 本轮结论

V78.3.0.31 真正值得复制的不是某一句提示词，而是这一套控制链：

```text
智能统一视觉基线
+
结构化人物 / 场景 / 人工要求
+
全局导演计划
+
语义批次执行
+
一行一卡 / 卡内多镜头
+
语义验收与失败行定向修复
+
程序确定性最终分段
+
Master Prompt 不可逆保护
```

如果公网按这个结构实现，`约束设置 → 画面前缀词 → 智能统一规则` 负责“全片长什么样”，第三 / 第四步负责“每一句具体怎么拍”，第五步只负责“怎么把已经确认的镜头无损装进最终视频段”，三层职责就不会互相污染。
