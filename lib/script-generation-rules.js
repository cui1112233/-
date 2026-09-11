const SMART_UNIFIED_PREFIX_PRESET_ID = 'script-constraint-prefix-smart-unified';

const SMART_UNIFIED_VISUAL_FIELD_ORDER = Object.freeze([
  'imageMedium',
  'captureProcess',
  'grainTexture',
  'filterColorSystem',
  'lensLanguage',
  'opticalCharacter',
  'contrast',
  'saturation',
  'lightingHierarchy',
  'narrativeComposition',
  'atmosphere'
]);

const SMART_UNIFIED_VISUAL_FIELD_LABELS = Object.freeze({
  imageMedium: '影像媒介',
  captureProcess: '成像介质',
  grainTexture: '颗粒与材质纹理',
  filterColorSystem: '滤镜与色彩体系',
  lensLanguage: '镜头语言基线',
  opticalCharacter: '光学特性',
  contrast: '对比度',
  saturation: '饱和度',
  lightingHierarchy: '光线与明暗层次',
  narrativeComposition: '叙事构图原则',
  atmosphere: '整体氛围'
});

function isSmartUnifiedPrefixEnabled(constraints) {
  return constraints?.prefix?.enabled === true
    && constraints?.prefix?.presetId === SMART_UNIFIED_PREFIX_PRESET_ID;
}

function normalizeAudioTargetSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 600) return null;
  return Math.ceil(parsed);
}

function buildStoryboardUnitDurationRules(duration) {
  if (duration === '15s') {
    return '当前选择 15s 单元规则：每个独立分镜单元不超过 15 秒；15s 模式无最低时长，实际时长由剧情、动作、对白与直接反应自然决定。每个单元内部时间轴从 00:00 开始，并连续结束于该单元实际时长。';
  }
  return '当前选择 10s 单元规则：每个独立分镜单元不超过 10 秒；10s 模式无最低时长，实际时长由剧情、动作、对白与直接反应自然决定。每个单元内部时间轴从 00:00 开始，并连续结束于该单元实际时长。';
}

function buildAudioMatchRules({ audioTotalSeconds, duration } = {}) {
  const total = normalizeAudioTargetSeconds(audioTotalSeconds);
  if (!total) return '';
  return [
    '## 匹配音频时长硬校验（最高优先级）',
    `当前已生成配音的实际总时长为 ${total} 秒；所有独立分镜单元的时长之和必须精确等于 ${total} 秒，连续覆盖整段视频，不得输出更长或更短的总时长。`,
    buildStoryboardUnitDurationRules(duration),
    '先按明确的场景、空间、时间、电话两端或叙事层切换拆分，再按单元时长规则拆分；不得为了补足音频时长重复动作、台词、静止口型或空镜。'
  ].join('\n');
}

function smartUnifiedVisualFieldText(value, key) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) throw new Error(`统一视觉字段 ${key} 不能为空`);
  if (text.length > 600) throw new Error(`统一视觉字段 ${key} 过长`);

  const shotLevelPatterns = [
    /\b\d{1,3}\s*mm\b/i,
    /\b\d{1,2}:\d{2}(?:\.\d+)?\b/,
    /(?:分镜|镜头)\s*(?:[一二三四五六七八九十]+|\d+)/,
    /(?:第\s*\d+\s*(?:镜|秒)|第[一二三四五六七八九十]+镜)/
  ];
  if (shotLevelPatterns.some(pattern => pattern.test(text))) {
    throw new Error(`统一视觉字段 ${key} 含单镜焦段、时间码或分镜级指令`);
  }
  return text;
}

function extractSmartUnifiedVisualFields(value) {
  const source = value?.fields && typeof value.fields === 'object' && !Array.isArray(value.fields)
    ? value.fields
    : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('统一视觉输出必须是 JSON 对象');
  }
  return Object.fromEntries(SMART_UNIFIED_VISUAL_FIELD_ORDER.map(key => [key, smartUnifiedVisualFieldText(source[key], key)]));
}

function buildSmartUnifiedVisualPrompt(value) {
  const fields = extractSmartUnifiedVisualFields(value);
  return SMART_UNIFIED_VISUAL_FIELD_ORDER
    .map(key => `${SMART_UNIFIED_VISUAL_FIELD_LABELS[key]}：${fields[key]}`)
    .join('；') + '。';
}

function normalizeSmartUnifiedVisualStyle(value) {
  const fields = extractSmartUnifiedVisualFields(value);
  return {
    fields,
    // 不信任模型自行拼接的 prompt；最终画面前缀始终由服务端按固定字段顺序重建。
    prompt: buildSmartUnifiedVisualPrompt(fields)
  };
}

function parseSmartUnifiedVisualStyle(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeSmartUnifiedVisualStyle(value);
  }
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('统一视觉分析必须返回合法 JSON');
  }
  return normalizeSmartUnifiedVisualStyle(parsed);
}

module.exports = {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  SMART_UNIFIED_VISUAL_FIELD_ORDER,
  SMART_UNIFIED_VISUAL_FIELD_LABELS,
  isSmartUnifiedPrefixEnabled,
  normalizeAudioTargetSeconds,
  buildStoryboardUnitDurationRules,
  buildAudioMatchRules,
  buildSmartUnifiedVisualPrompt,
  normalizeSmartUnifiedVisualStyle,
  parseSmartUnifiedVisualStyle
};
