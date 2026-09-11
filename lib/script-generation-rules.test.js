const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SMART_UNIFIED_VISUAL_FIELD_ORDER,
  buildStoryboardUnitDurationRules,
  buildSmartUnifiedVisualPrompt,
  normalizeSmartUnifiedVisualStyle
} = require('./script-generation-rules');

const completeFields = {
  imageMedium: '电影级真人短剧质感',
  captureProcess: '数字电影摄影，保留自然高光过渡',
  grainTexture: '极轻微细腻数字颗粒，不做粗重脏点',
  filterColorSystem: '克制中性色彩体系，肤色自然，场景主色服从剧情时代',
  lensLanguage: '自然叙事镜头语言，空间关系优先，不锁死单镜景别和焦段',
  opticalCharacter: '轻微真实光学呼吸与边缘衰减，避免夸张畸变',
  contrast: '中等电影反差，亮部有层次，暗部保持可读',
  saturation: '中低到自然饱和度，关键道具色彩可辨识',
  lightingHierarchy: '动机光优先，保留自然主辅光层次与环境反射，不指定单镜灯位',
  narrativeComposition: '人物关系、视线轴和空间纵深优先的电影级叙事构图',
  atmosphere: '克制、真实、具有连续戏剧张力的整体氛围'
};

test('10s rule is a maximum with no minimum duration', () => {
  const rule = buildStoryboardUnitDurationRules('10s');
  assert.match(rule, /不超过 10 秒|≤\s*10/);
  assert.match(rule, /无最低时长|没有最低时长/);
  assert.doesNotMatch(rule, /必须.*10 秒|正好 10 秒/);
});

test('15s rule is also only a maximum and does not require more than 10 seconds', () => {
  const rule = buildStoryboardUnitDurationRules('15s');
  assert.match(rule, /不超过 15 秒|≤\s*15/);
  assert.match(rule, /无最低时长|没有最低时长/);
  assert.doesNotMatch(rule, /大于 10 秒|10s <|10 秒且不超过 15 秒/);
});

test('smart unified style has exactly eleven ordered film-level fields', () => {
  assert.equal(Array.isArray(SMART_UNIFIED_VISUAL_FIELD_ORDER), true);
  assert.equal(SMART_UNIFIED_VISUAL_FIELD_ORDER.length, 11);
  assert.deepEqual(SMART_UNIFIED_VISUAL_FIELD_ORDER, [
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
});

test('smart unified prompt is deterministically assembled from the eleven fields', () => {
  const prompt = buildSmartUnifiedVisualPrompt(completeFields);
  assert.equal(typeof prompt, 'string');
  assert.match(prompt, /电影级真人短剧质感/);
  assert.match(prompt, /数字电影摄影/);
  assert.match(prompt, /自然叙事镜头语言/);
  assert.match(prompt, /动机光优先/);
  assert.match(prompt, /电影级叙事构图/);
  assert.match(prompt, /连续戏剧张力/);
  assert.equal(prompt.includes('undefined'), false);

  const positions = SMART_UNIFIED_VISUAL_FIELD_ORDER.map(key => prompt.indexOf(completeFields[key]));
  assert.equal(positions.every(position => position >= 0), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('normalization ignores any model supplied final prompt and rebuilds the authoritative prompt', () => {
  const normalized = normalizeSmartUnifiedVisualStyle({
    ...completeFields,
    prompt: '50mm 特写，人物向左走，右侧 45 度打灯'
  });

  assert.deepEqual(normalized.fields, completeFields);
  assert.equal(normalized.prompt, buildSmartUnifiedVisualPrompt(completeFields));
  assert.equal(normalized.prompt.includes('50mm'), false);
  assert.equal(normalized.prompt.includes('45 度打灯'), false);
});

test('normalization rejects incomplete smart unified output instead of silently inventing missing fields', () => {
  const incomplete = { ...completeFields };
  delete incomplete.atmosphere;
  assert.throws(() => normalizeSmartUnifiedVisualStyle(incomplete), /atmosphere|统一视觉|字段/);
});

test('normalization rejects shot-level timeline and focal-length leakage in film-level fields', () => {
  assert.throws(
    () => normalizeSmartUnifiedVisualStyle({ ...completeFields, lensLanguage: '00:00-00:03 使用 50mm 特写推进人物' }),
    /单镜|焦段|时间码|统一视觉/
  );
});
