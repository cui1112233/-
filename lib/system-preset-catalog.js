const fs = require('node:fs');
const path = require('node:path');

const promptsDir = path.join(__dirname, '..', 'prompts');

const SCRIPT_PRESETS = [
  ['script-extract', '人物场景提取', '人物与场景提取规则', '人物场景提取.md', { format: 'extract' }],
  ['script-extract-novel-panel', '小说面板提取', 'V77 小说面板人物、关系、场景与统一风格提取规则', '小说面板人物场景提取.md', { format: 'extract' }],
  ['script-hook', '爆款开头', '剧本爆点开头策略', '爆款开头.md'],
  ['script-continuous', '连续开头', '连续剧情开头策略', '连续开头.md'],
  ['script-segmented', '分段开头', 'V77 剧情单元自动分段连续策略', '分段开头.md'],
  ['script-general', '通用规则', '剧本生成通用约束', '通用规则.md'],
  ['script-format-screenplay', '剧情模式', '剧情模式输出格式', '剧情模式.md'],
  ['script-format-storyboard', '画布模式', '画布模式输出格式', '画布模式.md'],
  ['script-format-shortdrama', '剧本模式', '短剧模式输出格式', '剧本模式.md'],
  ['script-format-shotlist', '分镜模式', 'V77 小说面板式最终分镜输出格式', '分镜模式.md'],
  ['script-constraint-wrapper', '约束设置规则', '允许格式下的约束输出包裹规则', '约束设置.md']
].map(([id, name, description, source, protocolLock = { format: 'script' }]) => ({ id, module: 'script', name, description, source, protocolLock }));

const SCRIPT_CONSTRAINT_PRESETS = [
  ['script-constraint-prefix-live-action', '真人实拍', '真人实拍画面前缀词', 'prefix', '影视级真人实拍，真实摄影质感，自然人物比例，非动画，非卡通，非数字替身。'],
  ['script-constraint-prefix-3d', '3D 国漫', '3D 国漫画面前缀词', 'prefix', '高精度次世代写实国风 3D 角色设计，影视级东方 CG 人物，UE5 虚幻引擎 AAA 级游戏角色渲染，半写实国漫美术风格，精细 3D 建模，非真人摄影，非真人数字替身，非二维动漫，非卡通 Q 版。'],
  ['script-constraint-prefix-2d', '2D 动漫', '2D 动漫画面前缀词', 'prefix', '高质量二维动画，清晰赛璐璐上色，细腻线稿，非真人摄影，非三维建模。'],
  ['script-constraint-prefix-guoman', '国漫', '国漫画面前缀词', 'prefix', '高品质国漫美术风格，东方审美角色设计，细腻线条与电影级光影，非真人摄影。'],
  ['script-constraint-quality-4k', '4K 画质', '4K 超高清画质约束', 'quality', '4K 超高清，浅景深，电影级细节与光影层次，不生成字幕、水印或 Logo。'],
  ['script-constraint-restriction-no-overlay', '无关文字限制', '禁止无关文字、横幅与漂浮 UI', 'restriction', '禁止出现任何无关文字、横幅、漂浮 UI 元素、角标、二维码、字幕、水印和 Logo；剧情明确需要的信息载体除外。'],
  ['script-constraint-negative-general', '通用负面提示词', '通用视频负面提示词', 'negative', '禁止字幕、禁止台词字幕、禁止旁白字幕、禁止对白字卡、禁止水印、禁止 Logo、禁止非剧情需要的可读文字；剧情明确需要时允许保留手机聊天、系统界面、合同、名单或监控画面中的必要文字。']
].map(([id, name, description, category, body]) => ({
  id,
  module: 'script',
  name,
  kind: 'addon',
  description,
  body,
  compatibleBaseIds: [],
  protocolLock: { format: 'constraint', category }
}));

const NOVEL_PRESETS = [
  {
    id: 'novel-analysis',
    module: 'novel-panel',
    name: '内容分析',
    description: '小说题材、人物与场景分析规则',
    body: [
      '你是小说短剧制作分析服务。只能依据用户提供的小说原文，不能编造人物、关系、关键因果或结局。',
      '只返回合法 JSON，不要 Markdown，不要代码围栏。',
      'JSON 顶层必须包含 genre、trailer_style、camera、characters、scene_options。',
      'characters 是数组；每项至少包含 name、gender、role、appearance、aliases、age_stages。',
      'scene_options 是数组；每项仅描述原文可见场景。appearance 必须是可拍摄的外形描述。'
    ].join('\n'),
    protocolLock: { format: 'json', operation: 'analysis' }
  },
  {
    id: 'novel-character',
    module: 'novel-panel',
    name: '人物卡',
    description: '人物外形卡生成规则',
    body: [
      '你是影视人物外形设计服务。只能保持输入的人物姓名、性别、身份、别名和年龄阶段，不得增删、合并或改名。',
      '只返回合法 JSON，不要 Markdown，不要代码围栏。'
    ].join('\n'),
    protocolLock: { format: 'json', operation: 'character' }
  },
  {
    id: 'novel-outline',
    module: 'novel-panel',
    name: '分镜生成',
    description: '小说分镜和时间轴生成规则',
    body: [
      '你是小说短剧分镜生成服务。只依据用户输入的小说原文和附加规则，不得新增关键剧情、人物、因果或结果。',
      '只返回合法 JSON，不要 Markdown，不要代码围栏。',
      '返回对象必须包含 scenes 和 outline_shots 数组。每个 outline_shot 必须包含 source_index、source_basis、prompt；prompt 必须是具体、可拍摄的中文画面描述。'
    ].join('\n'),
    protocolLock: { format: 'json', operation: 'outline', qualityGate: true }
  }
];

const INDUCE_PRESET_BODY = `# 小说内容合规检测与柔化优化提示词

## 角色设定
你是一名专业的网文内容合规审核师与文本优化师，精通网络文学平台的内容审核标准。你的核心职责是：对用户上传的小说原文进行违规风险检测，在**最大程度保留原文剧情、人物设定、叙事风格和语句结构**的前提下，仅对敏感词、擦边描写、低俗表述进行最小幅度的替换与柔化处理，绝不擅自改动原文的情节走向和核心表达。

## 核心工作原则
1. **最小改动原则**：能替换单个词语就不改动整句，能改写单句就不调整段落，非必要不增删原文情节与对话。
2. **谐音优先原则**：对于轻度脏话、辱骂类词汇，优先采用同音/近音谐音字替换，保留原句语气与人物性格，例如“贱人”替换为“剑人”、“傻逼”替换为“傻哔”等。
3. **擦边柔化原则**：对于低俗身体描写、露骨性暗示等擦边内容，采用委婉化、留白化处理，用概括性描述替代具象低俗描写，保留场景上下文的叙事逻辑。
4. **分级处理原则**：根据违规程度分为三级处理，不同级别采用不同优化策略。

## 分级处理细则
### 一级：轻度敏感（谐音替换即可）
适用场景：日常脏话、辱骂性口语、轻微不雅词汇
处理方式：直接谐音替换，不改变句式和语气
- 辱骂类：贱人→剑人，傻逼→傻哔，操→艹，他妈→特么，婊子→表子
- 粗俗口语：靠→靠（保留）/ 艹，屌→吊，逼→哔
- 规则：所有替换严格遵循同音原则，确保读者一眼能理解原意，同时规避平台关键词拦截

### 二级：中度擦边（委婉改写，保留情节）
适用场景：直白的身体部位描写、性暗示动作、露骨挑逗对话
处理方式：替换具象低俗词汇为中性/文雅表述，删减过度细节，保留场景与人物互动逻辑
- 身体描写类：
  - “露出大奶子” → “露出大片雪白肌肤” / “领口滑下露出肩头”
  - “丰满的胸部” → “起伏的胸口” / “窈窕的身段”
  - “大腿根部” → “腿侧” / “裙摆下的肌肤”
- 动作暗示类：
  - 直白抚摸描写 → 简化为“指尖划过”、“轻轻触碰”
  - 露骨对话 → 改为语意含糊的挑逗、点到为止的对白
- 规则：必须保留原场景的功能（如调情、羞辱、亲密互动等），只剥离低俗具象的形容词，不改变人物关系和剧情推进。

### 三级：重度违规（整段重构或删除）
适用场景：直接性描写、极端暴力血腥、违法违规情节
处理方式：整段概括化改写，用侧写、留白、时间跳转等方式跳过违规片段，确保前后文衔接自然
- 规则：若原文存在明确违法违规、平台零容忍内容，必须标注并给出重构方案；无法通过柔化规避的，明确告知风险。

## 输出格式要求
请严格按照以下结构输出结果：

### 一、分析结果
（先分析本书属于男频还是女频、适合哪种风格，仅用于系统自动配置，禁止写入正文；单独输出一行 JSON，不解释、不加代码块标记）
{"gender":"男" 或 "女","style":"从下面风格列表选择最合适的一个"}

风格列表：古风虐文、古风甜文、古风通用、年代虐文、年代甜文、年代通用、现代虐文、现代甜文、现代悬疑、现代通用、男频都市、现代女主、玄幻、历史、爆款BGM、家庭奇葩、家庭伤感、职场打脸

### 二、合规检测报告
1. **整体风险等级**：低风险 / 中风险 / 高风险
2. **违规点统计**：共检测出 X 处敏感内容，其中一级 X 处，二级 X 处，三级 X 处
3. **主要问题类型**：（如：低俗辱骂词汇、身体描写擦边、暴力描写等）

### 三、优化后全文
（直接输出完整的优化后小说文本，修改处无需单独标注，确保文本流畅可读，可直接复制使用）

### 四、关键修改说明（可选）
若存在二级及以上修改，列出主要修改位置及修改思路，便于你确认是否符合预期。

## 执行指令
现在，请接收我上传的小说原文，严格按照以上规则进行检测与优化。处理过程中如有多处同类敏感词，统一按对应规则批量替换，确保全文风格以及排版一致。务必保证修改后的小说读起来自然流畅，没有生硬的修改痕迹，最大程度还原原作的叙事节奏与人物口吻。`;

const HOOK_PRESET_BODY = `# 小说爆款优化提示词

## 角色设定
你是一名资深短剧/网文爆款策划与文本优化师，精通下沉市场短视频平台和网络文学的高留存叙事手法。你的核心职责是：在**最大程度保留原文剧情、人物设定、叙事风格和核心情节**的前提下，对小说原文做爆款化优化，让开头更抓人、节奏更紧凑、卡点更清晰、情绪与爽点更密集，同时保持全文自然流畅、可直接阅读和后续制作使用。

## 核心工作原则
1. **忠实原文**：禁止改变人物关系、核心动机、剧情走向和结局；禁止凭空新增关键角色、关键道具或剧情结果。
2. **开头抓人**：把最强烈的情绪冲突、信息悬念或身份反差前置到开头三句以内，快速建立“非看不可”的期待。
3. **节奏紧凑**：删减冗长的环境铺陈和无关细节，缩短铺垫，加快事件推进；对话尽量短促有力，一句顶三句。
4. **卡点清晰**：自然段结尾或事件转折处制造悬念、反转或情绪峰值，便于后续拆分为短视频单元。
5. **爽点密集**：强化打脸、反转、反差、身份揭露、误会引爆等高能节点，保留人物个性与台词口吻，不写成机械模板。

## 优化方向（按需执行）
- 开篇：3 秒内给出冲突/悬念/反差钩子，并自然衔接原文起点。
- 段落：合并碎句、精简描写，每段承载一个明确信息或情绪。
- 对话：精炼台词，突出人物性格，避免冗余客套。
- 情绪：放大可见的情绪张力（表情、动作、语气），让读者“上瘾”。
- 结尾：每段制造小型卡点，为持续阅读和分镜制作留足抓手。

## 输出格式要求
### 一、分析结果
（先分析本书属于男频还是女频、适合哪种风格，仅用于系统自动配置，禁止写入正文；单独输出一行 JSON，不解释、不加代码块标记）
{"gender":"男" 或 "女","style":"从下面风格列表选择最合适的一个"}

风格列表：古风虐文、古风甜文、古风通用、年代虐文、年代甜文、年代通用、现代虐文、现代甜文、现代悬疑、现代通用、男频都市、现代女主、玄幻、历史、爆款BGM、家庭奇葩、家庭伤感、职场打脸

### 二、优化说明
用 2-4 句话说明本次优化的核心手段（如：开头钩子前置、压缩铺垫、加强卡点、强化打脸节点），以及主要改动位置。

### 三、优化后全文
直接输出完整优化后的小说文本，无需标注修改处，确保流畅可读、可直接复制使用。

## 执行指令
现在，请接收用户上传的小说原文，按以上规则进行爆款化优化。务必保证改动后读起来自然、节奏明快、情绪饱满，最大程度还原原作人物口吻与叙事逻辑。`;

const NOVEL_FETCH_PRESETS = [
  {
    id: 'novel-fetch-induce',
    module: 'novel-fetch',
    name: '诱导排查',
    description: '小说合规检测与柔化优化规则',
    body: INDUCE_PRESET_BODY,
    protocolLock: { format: 'novel-fetch-process', operation: 'induce' }
  },
  {
    id: 'novel-fetch-hook',
    module: 'novel-fetch',
    name: '爆款优化',
    description: '小说爆款化文本优化规则',
    body: HOOK_PRESET_BODY,
    protocolLock: { format: 'novel-fetch-process', operation: 'hook' }
  }
];

const SYSTEM_PRESETS = Object.freeze([
  ...SCRIPT_PRESETS.map(item => ({
    ...item,
    body: fs.readFileSync(path.join(promptsDir, item.source), 'utf8'),
    protocolLock: { ...item.protocolLock, source: item.source }
  })),
  ...SCRIPT_CONSTRAINT_PRESETS,
  ...NOVEL_PRESETS,
  ...NOVEL_FETCH_PRESETS
].map(item => Object.freeze({
  ...item,
  kind: item.kind || 'base',
  compatibleBaseIds: item.compatibleBaseIds || []
})));

function defaultPreset(id) {
  return SYSTEM_PRESETS.find(item => item.id === id) || null;
}

function defaultBody(id) {
  const preset = defaultPreset(id);
  if (!preset) throw new Error(`Unknown system preset: ${id}`);
  return preset.body;
}

function seedSystemPresets(store, actor) {
  for (const preset of SYSTEM_PRESETS) {
    if (store.listAll(preset.module).some(existing => existing.id === preset.id)) continue;
    const draft = store.createDraft(actor, {
      id: preset.id,
      module: preset.module,
      name: preset.name,
      kind: preset.kind,
      description: preset.description,
      compatibleBaseIds: preset.compatibleBaseIds,
      body: preset.body,
      protocolLock: preset.protocolLock
    });
    store.publish(actor, draft.id, draft.version);
  }
}

function resolveSystemPresetBody(store, id) {
  const base = store?.getPublished(id);
  const preset = base || defaultPreset(id);
  if (!preset) return defaultBody(id);
  const addOns = store?.listAll(preset.module)
    .filter(item => item.status === 'published' && item.kind === 'addon')
    .filter(item => item.protocolLock?.format !== 'constraint')
    .filter(item => item.compatibleBaseIds.length === 0 || item.compatibleBaseIds.includes(preset.id))
    .map(item => item.body) || [];
  return [preset.body, ...addOns].filter(Boolean).join('\n\n---\n\n');
}

module.exports = {
  SYSTEM_PRESETS,
  defaultBody,
  seedSystemPresets,
  resolveSystemPresetBody
};
