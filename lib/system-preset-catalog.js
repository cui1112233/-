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

const SYSTEM_PRESETS = Object.freeze([
  ...SCRIPT_PRESETS.map(item => ({
    ...item,
    body: fs.readFileSync(path.join(promptsDir, item.source), 'utf8'),
    protocolLock: { ...item.protocolLock, source: item.source }
  })),
  ...SCRIPT_CONSTRAINT_PRESETS,
  ...NOVEL_PRESETS
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
  return [preset.body, ...addOns].filter(Boolean).join('\n\n');
}

module.exports = {
  SYSTEM_PRESETS,
  defaultBody,
  seedSystemPresets,
  resolveSystemPresetBody
};
