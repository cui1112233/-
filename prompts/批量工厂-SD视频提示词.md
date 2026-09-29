# 批量工厂 SD 视频提示词

本预设用于批量工厂的"SD 视频提示词"，作为分镜生成阶段的一次 AI 调用提示词。选择此预设时，系统自动应用故事剧本规则、固定镜头导演规则、最终 Prompt 模板和分镜规划跟随配音规则，用户无需单独选择这些内部规则。

本预设汇集以下 SD 源文档章节：第 5 节（完整配音、逐行探针和时间计划）、第 11 节（整段原文转逐行故事剧本）、第 12 节（冻结故事剧本生成固定镜头画面）、第 13 节（本地故事板与时间守恒）、第 15 节（发给视频生成 AI 的最终 Prompt）。这些章节共同构成 SD 视频提示词的完整规则链：配音决定时长，故事剧本做视觉转换，固定镜头导演填写画面，本地故事板绑定时间轴，最终 Prompt 模板拼装供应商请求。所有章节正文均完整保留源文档原文，不摘要、不总结、不压缩。

---

## 原 SD：第5节 完整配音、逐行探针和时间计划（系统规则，不发给文本 AI）

### 5.1 TTS 请求

完整原文调用一次 TTS；每一行再使用完全相同的 voice、style、speed、pitch 独立调用一次用于测量。请求体：

```json
{
  "input": "${完整原文或单行原文}",
  "voice": "${VOICE}",
  "speed": 1.8,
  "pitch": 0,
  "style": "${STYLE}"
}
```

逐行探针音频只用于 `ffprobe` 测量，测量后立即删除；最终只保留完整配音。逐行探针失败时，新 SD 流程允许退化为原文权重估算；完整配音失败则任务失败。

### 5.2 朗读权重

```text
汉字 = 1.00
数字 = 0.85
英文单词 = 1.25
其他可读字符 = 0.75
短停顿（、，,）= 0.18
中停顿（；;：:）= 0.30
完整停顿（。！？!?）= 0.48
延长停顿（…—，按每个字符累计）= 0.60

朗读权重 = 可读字符权重合计 / TTS语速 + 标点停顿权重
```

故事剧本字符数不得进入该公式。

### 5.3 逐行探针尾音修正

```text
平均尾音误差 = max(0, (逐行探针总时长 - 完整配音真实时长) / 原文行数)
每行初步时长 = max(普通最小行时长, 本行探针时长 - 平均尾音误差)
```

普通最小行时长为 200ms。只有在 `完整配音毫秒数 < 行数 × 200ms`、数学上无法满足时，才把最小值放宽到 1ms。

初步时长与完整配音仍有毫秒误差时，按原文朗读权重分配或扣除，最后必须满足：

```text
Σ(原文行时长毫秒) = 完整配音时长毫秒
```

### 5.4 原文标点切镜

- 边界字符：`， , ； ; 。 . ! ！ ? ？ …`
- 连续标点归入同一个前置片段。
- 右引号 `” ’ 」 』 》 ） 】 〉 〕` 附着在前一个片段。
- 冒号和顿号默认不单独切镜。
- 只读取原文标点，不读取故事剧本标点。
- 不跨原文行合并。

每个原文标点片段按自身原文字数、停顿和语速，从所属行时长中按比例取得整数毫秒。系统从左向右累积不足 800ms 的相邻片段，达到 800ms 后形成一个镜头；最后剩余不足 800ms 时并入前一个镜头。

必须满足：

```text
Σ(一行所有镜头时长) = 该行原文时长
Σ(所有行时长) = 完整配音时长
```

内部 ID 使用 `L0001-P01`（原文标点范围）和 `L0001-S01`（合并后镜头），只用于绑定和校验，绝不能作为“剧本节拍”发给视频供应商。

---

## 原 SD：第11节 AI 调用六：整段原文转逐行故事剧本

阶段：`SD_STORY_SCRIPT`  
Prompt Key：`sd.story-script.whole-source`  
版本：`v78.3.0.121-sd-story-script-v1`  
调用次数：整个任务一次。不得按行分别调用，不得增加第二次修复请求。

### 11.1 注入变量

- `${LINE_COUNT}`：原文有效行数。
- `${LINE_CONTRACT_JSON}`：每行的 `source_index/source_text/source_span_keys`。
- `${STYLE_JSON}`：只包含 `content_type/sd_unified_style`。
- `${CHARACTER_GRAPH_JSON}`：冻结的人物、外形、关系和别名图。
- `${SOURCE}`：完整原文，原顺序、原换行。

逐行契约示例：

```json
[
  {
    "source_index": 1,
    "source_text": "第一行原文。",
    "source_span_keys": ["L0001-P01"]
  }
]
```

### 11.2 完整 System Prompt

```text
你是“整段原文转逐行画面故事剧本”编剧。先完整通读全文、人物关系和统一风格，再把每一行原文转换为一行适合视频模型理解的非语言画面故事剧本。只返回一个合法 JSON 对象，不要 Markdown、解释或自检。
最高约束：原文一行只能对应 rows 中同一 source_index 的一行故事剧本；行数、行号和顺序不可改变，不合并、不拆行、不把后文事件提前，也不把本行事件移到别行。
story_script_line 只负责视觉转换：可以补充为拍摄所需的具体表情、环境反应、空间关系和动作细节，使画面更精彩、更清楚；不得新增原文没有的重要人物、行为、因果、证据、数字、地点、结果或结局，不得改变否定、假设、威胁、回忆与已发生事实的性质。
原文中的具体年龄数字只留在 source_text 事实层；story_script_line、characters、objects 和连续状态只用少年、少女、年轻男性、年轻女性、中年、老年等年龄阶段，不得出现“18岁”类具体年龄。
对话和旁白要转换成能看见的行动、站位、目光、道具状态、环境结果或他人反应；人物自然闭口，不设计口型、可读字幕、纸面正文或界面文字。
source_text 必须逐字原样返回。covered_source_span_keys 必须逐项原样返回本行契约中的全部 key，顺序一致、无遗漏、无重复；这些 key 只用于程序验证，不要为它们分别写剧本、时长或节拍。
continuity_in 与 continuity_out 只记录本行开始和结束时的人物位置、姿态、视线、持物、服装、环境与动作终点；下一行只能继承状态，不能提前发生下一行事件。
返回结构：{"rows":[{"source_index":1,"source_text":"原文原句","story_script_line":"对应本行的完整非语言画面故事剧本","characters":["本行人物"],"objects":["关键物体"],"continuity_in":{"summary":"本行进入状态"},"continuity_out":{"summary":"本行结束状态"},"covered_source_span_keys":["L0001-P01"]}]}
返回前确认 rows 恰好为 ${LINE_COUNT} 行，且每一行只表达自己的原文。
逐行原文契约：${LINE_CONTRACT_JSON}
统一风格资料：${STYLE_JSON}
统一人物关系资料：${CHARACTER_GRAPH_JSON}
完整原文：
${SOURCE}
```

User Prompt：

```text
仅返回约定的完整 rows JSON。
```

### 11.3 `continuity_in/out` 可用结构

简单实现只返回 `summary` 即可；完整结构允许：

```json
{
  "summary": "状态摘要",
  "scene_id": "场景稳定ID",
  "location": "地点",
  "time_weather": "时间与天气",
  "axis": "空间轴线",
  "light_direction": "光线方向",
  "positions": {"CHAR_001": "人物位置"},
  "facings": {"CHAR_001": "朝向"},
  "gazes": {"CHAR_001": "视线"},
  "held_props": {"CHAR_001": "持物"},
  "wardrobe_states": {"CHAR_001": "服装状态"},
  "appearance_states": {"CHAR_001": "外观状态"},
  "environment_states": {"环境对象": "状态"},
  "emotion_states": {"CHAR_001": "可见情绪"},
  "action_ends": {"CHAR_001": "本行动作终点"}
}
```

### 11.4 程序必须执行的硬校验

1. `rows.length == 原文有效行数`。
2. 每个数组位置的 `source_index` 必须等于契约行号。
3. `source_text` 必须逐字等于冻结原文行。
4. `story_script_line` 不能为空。
5. `continuity_in` 和 `continuity_out` 都不能为空。
6. `covered_source_span_keys` 必须与本行契约完全相等，顺序一致、无缺失、无重复。
7. `story_script_line/characters/objects/continuity` 中不得出现具体年龄数字。
8. 故事剧本新增原文不存在的受保护数字事实时，报 `SD_STORY_CONTENT_MISMATCH`。
9. 原文数字或已登记人物未在视觉改写中复述时记录警告，但冻结 `source_text` 仍是下游权威，因此不因同义改写误报而阻断。
10. 第 N 行最终 `continuity_in` 由系统强制替换为第 N-1 行冻结的 `continuity_out`，防止状态漂移。

解析、行契约或年龄校验失败：`SD_STORY_SCRIPT_INVALID`。原始响应必须保存在 `sd_story_script_raw`，失败时零视频供应商请求。

---

## 原 SD：第12节 AI 调用七：冻结故事剧本生成固定镜头画面

阶段：`SD_DIRECTOR_PLAN`  
Prompt Key：`sd.director.fixed-original-shots`  
版本：`v78.3.0.122-sd-original-shot-plan-v1`  
调用次数：整个任务一次；不分块、不自动重试、不切模型、不发送修复请求。

### 12.1 注入变量

- `${SHOT_CONTRACT_JSON}`：所有行及系统预先确定的每个镜头。
- `${STYLE_JSON}`：`content_type/sd_unified_style`。
- `${CHARACTER_GRAPH_JSON}`：冻结人物关系图。
- `${DIRECTOR_REQUIREMENT}`：人工导演要求、必拍要求、镜头节奏要求，用 `；` 合并。
- `${ASPECT_RATIO}` / `${RESOLUTION}`：单供应商值或“按固定链路逐段：...”摘要。
- `${SOURCE}`：完整原文。

固定镜头契约示例：

```json
[
  {
    "source_index": 1,
    "source_text": "原文行",
    "story_script_line": "已冻结故事剧本",
    "continuity_in": {"summary":"进入状态"},
    "continuity_out": {"summary":"结束状态"},
    "shots": [
      {
        "shot_key": "L0001-S01",
        "source_span_keys": ["L0001-P01"],
        "original_source_text": "本镜覆盖原文",
        "duration_seconds": 1.234
      }
    ]
  }
]
```

### 12.2 完整 System Prompt

```text
你是 SD 画面导演。故事编剧已经完成，系统也已经依据原文配音和原文标点锁定每行镜头数量、顺序和时长。你只能为这些镜头填写可拍画面，不得改写故事剧本，不得新增、删除、合并、拆分、调序或重新计时。只返回一个合法 JSON 对象，不要 Markdown、解释、自检或额外字段。
每行 source_index、source_text、story_script_line 必须逐字原样返回。每个 micro_shot 的 shot_key、source_span_keys、original_source_text 和 duration_seconds 必须逐项原样返回。
每个镜头只表达 original_source_text 覆盖的原文内容，同时参考整行 story_script_line 增强画面；不能把后一镜或后一行事件提前，不能为了填镜头创造关门、转身、离场等原文没有的剧情。
原文中的具体年龄数字不得进入 scene、visual、composition、visible_range、end_state 或任何画面字段；必须使用人物资料中的年龄阶段。
画面使用自然闭口的非语言叙事，不生成口型、对白、字幕、可读纸面正文或界面文字。要写清人物与物体站位、动作发起者、作用对象、可见结果、他人反应、镜头结束状态。
每个 micro_shot 必须填写 visual、shot_size、visible_range、focal_length、camera_side、camera_height、camera_angle、composition、camera_movement、environment_lighting、subject_lighting、visibility_target、end_state；每镜只使用一个清楚的主运镜。
相邻镜头和相邻行严格承接真实结束状态；只继承人物位置、姿态、视线、持物、服装、环境与动作终点，不继承未来事件。
返回结构：{"rows":[{"source_index":1,"source_text":"原文","story_script_line":"冻结的画面故事剧本","scene":"具体地点、时间、空间和光源","continuity_in":{"summary":"进入状态"},"continuity_out":{"summary":"结束状态"},"micro_shots":[{"shot_key":"L0001-S01","source_span_keys":["L0001-P01"],"original_source_text":"本镜原文范围","duration_seconds":1.234,"visual":"完整可拍画面","shot_size":"中景","visible_range":"可见范围","focal_length":"50mm","camera_side":"侧前方","camera_height":"平视","camera_angle":"平视","composition":"人物、道具和前中后景","camera_movement":"唯一主运镜及停止位置","environment_lighting":"环境光","subject_lighting":"人物与关键物体光线","visibility_target":"必须看清的内容","end_state":"稳定结束状态"}]}]}
逐行固定镜头契约：${SHOT_CONTRACT_JSON}
统一风格资料：${STYLE_JSON}
统一人物关系资料：${CHARACTER_GRAPH_JSON}
人工导演要求：${DIRECTOR_REQUIREMENT}
画幅：${ASPECT_RATIO}；分辨率：${RESOLUTION}
完整原文：
${SOURCE}
```

User Prompt：

```text
仅返回约定的完整 rows JSON。
```

### 12.3 程序绑定规则

AI 返回后，系统必须按契约覆盖而不是信任 AI：

- 行数、行号、原文、故事剧本必须与冻结值一致。
- 每行 `micro_shots` 数量必须完全相等。
- 每镜 `shot_key/source_span_keys/original_source_text` 必须完全相等。
- AI 返回的 `duration_seconds` 即使不同也不能生效，系统强制使用冻结时长；如果绑定结构不一致则整体失败。
- `scene` 以及所有可见镜头字段不得包含具体年龄数字。
- 相邻镜头的内部连续状态由系统按冻结结束状态补齐。
- 失败状态为 `SD_DIRECTOR_LOCAL_PARSE_FAILED` 或 `SD_DIRECTOR_SHOT_MISMATCH`；失败时零视频供应商请求。

---

## 原 SD：第13节 本地故事板与时间守恒

`SD_STORYBOARD` 不调用 AI。它把导演填写的画面绑定到固定时间轴，并执行：

1. 时间轴行数必须等于原文行数。
2. 每行 `source_index` 必须一致。
3. 每行时长毫秒必须等于 `SD原文时间计划`。
4. 每行镜头毫秒之和必须等于本行毫秒。
5. 所有行毫秒之和必须等于完整配音毫秒。
6. 任何不守恒都报 `SD_TIMELINE_MISMATCH`。
7. 人物别名归一和必要临时人物只能在此阶段做确定性绑定，不能重新调用 AI 改剧情。

---

## 原 SD：第15节 发给视频生成 AI 的最终 Prompt

版本：`sd.prompt.normal.v11`。本段不是文本分析 AI 的 System Prompt，而是最终发送给 SD 视频供应商的 `prompt/content.text`。

### 15.1 完整结构模板

```text
统一风格：
${SD_UNIFIED_STYLE}

统一人物：
人物1 ${VIDEO_NAME_1}：${VIDEO_APPEARANCE_ANCHOR_1}
人物2 ${VIDEO_NAME_2}：${VIDEO_APPEARANCE_ANCHOR_2}

段内执行约束：按场景编号依次完成；每场核心动作与可见结果完成后再转场，不合并、不跳过场景。

[场景 1｜对应原文第 ${SOURCE_INDEX} 行｜总时长 ${LINE_SECONDS_3_DECIMALS} 秒]

画面故事剧本（仅作为画面内容依据，不参与计时）：
${FROZEN_STORY_SCRIPT_LINE}

场景环境：
${SCENE_DESCRIPTION}

[镜头 1｜时长 ${SHOT_SECONDS_3_DECIMALS} 秒]
${RENDERED_SHOT_BODY}

[镜头 2｜时长 ${SHOT_SECONDS_3_DECIMALS} 秒]
${RENDERED_SHOT_BODY}

${如果API请求时长大于真实剧情时长：最后一镜额外稳定保持X.XXX秒，不推进下一行剧情。}

【最终导出画质约束】
以4K级细节为画质目标，实际分辨率与帧率按生成配置设置。主体焦点稳定，景深符合拍摄任务，人物保留真实皮肤、发丝和衣物纹理，关系镜头保留理解站位所需的环境清晰度。环境允许阴暗、夜间或低调，但人物面部、眼睛、手部动作、服装轮廓和关键道具必须保持清晰可读的中间调；使用符合场景来源的主光、柔和补光或轮廓分离光保护主体，并与背景形成明确层次。运动、材质反射与光影变化自然连贯，高光不过曝，黑位保留纹理。无暗角、无人工边缘压黑，不以过度磨皮或锐化代替真实细节。

【最终导出负面提示词】
主体意外失焦，过度运动模糊，面部变形，身份漂移，人物外形串线，同脸化，人物无故复制，无关人物，多余肢体，手指异常，肢体融合，穿模，服装跳变，道具漂移，空间结构跳变，错误透视，人物瞬移，视线错位，提前出场，动作无故重复，动作状态复位，光线无故闪变，过曝高光，面部欠曝，五官消失，眼睛无细节，手部动作不可辨，主体与背景粘连，纯黑剪影，黑位吞没人物，彩色光污染肤色，塑料皮肤，过度磨皮，过度锐化，暗角，可读字符载体，大面积字符层，可辨识界面文字，水印；人物保持自然闭口。
```

### 15.2 人物区渲染规则

- 只输出本段实际出现的正式人物。
- 名称优先级：`video_name > canonical_name > stage_label > slot_token`。
- 外形优先使用结构化 `video_appearance_profile` 构建的稳定锚点，否则使用 `video_appearance_anchor`，最后才回退到 `appearance`。
- 人物标签依次为“人物1、人物2……”。
- 最终再次清理具体年龄数字、规则说明、不可见元数据和危险可读文本。

### 15.3 单镜正文渲染规则

每个 `${RENDERED_SHOT_BODY}` 按以下顺序拼接：

1. 镜头参数：`shot_size + visible_range + focal_length + camera_side + camera_height + camera_angle`。
2. 构图：`composition`，缺失时使用 `blocking`。
3. 可拍画面：优先 `visual`；为空时根据参与者位置、朝向、视线、动作、反应、动作进程、道具变化和表情确定性回退。
4. 如果 `props` 中的关键道具没有出现在画面或构图中，补充“画面可见……”描述。
5. 主运镜：`camera_movement + movement_target + movement_path + movement_stop`。
6. 光线：`environment_lighting + subject_lighting + lighting`。
7. 可视重点：`visibility_target`。
8. 结束状态：`end_state`；为空时从各参与者 `end_state` 合成。

每镜只保留一个主运镜，去除重复句。最终 Prompt 不输出 `L0001-S01/L0001-P01`，不输出“剧本节拍”，也不输出内部起止毫秒。

### 15.4 固定档位时长

供应商只接受 15 秒、30 秒等档位时：

- `real_duration_seconds` 保持真实剧情时长。
- `api_duration_seconds` 向上选择最小可支持档位。
- 多出的时间全部写成“最后一镜额外稳定保持”，不得均摊到所有镜头，不得推进下一行剧情。
