const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');
const {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  isSmartUnifiedPrefixEnabled,
  normalizeAudioTargetSeconds,
  buildAudioMatchRules,
  buildStoryboardUnitDurationRules
} = require('../lib/script-generation-rules');

test('smart unified is enabled only by the prefix system preset', () => {
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: true, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), true);
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: true, presetId: 'script-constraint-prefix-live-action' } }), false);
  assert.equal(isSmartUnifiedPrefixEnabled({ prefix: { enabled: false, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), false);
});

test('audio target rounds up a valid duration and rejects invalid values', () => {
  assert.equal(normalizeAudioTargetSeconds(28.01), 29);
  assert.equal(normalizeAudioTargetSeconds('28'), 28);
  assert.equal(normalizeAudioTargetSeconds(0), null);
  assert.equal(normalizeAudioTargetSeconds('bad'), null);
});

test('audio match rules keep the selected 10s or 15s unit rule', () => {
  const ten = buildAudioMatchRules({ audioTotalSeconds: 28, duration: '10s' });
  assert.match(ten, /时长之和必须精确等于 28 秒/);
  assert.match(ten, /每个独立分镜单元不超过 10 秒/);
  assert.match(ten, /10s 模式无最低时长/);

  const fifteen = buildAudioMatchRules({ audioTotalSeconds: 28, duration: '15s' });
  assert.match(fifteen, /每个独立分镜单元原则上大于 10 秒且不超过 15 秒/);
  assert.match(fifteen, /空间切换和最终收尾可以短于 10 秒/);
});

test('unit duration rules preserve short boundary units instead of forcing exact 10s or 15s', () => {
  const ten = buildStoryboardUnitDurationRules('10s');
  assert.match(ten, /不超过 10 秒/);
  assert.match(ten, /无最低时长/);
  assert.doesNotMatch(ten, /总时长只能是 10s/);

  const fifteen = buildStoryboardUnitDurationRules('15s');
  assert.match(fifteen, /原则上大于 10 秒且不超过 15 秒/);
  assert.match(fifteen, /空间切换和最终收尾可以短于 10 秒/);
  assert.doesNotMatch(fifteen, /总时长只能是 15s/);
});

test('system catalog contains the Smart Unified image-prefix preset and backend prompt', () => {
  const preset = SYSTEM_PRESETS.find(item => item.id === SMART_UNIFIED_PREFIX_PRESET_ID);
  assert.ok(preset);
  assert.equal(preset.name, '智能统一');
  assert.deepEqual(preset.protocolLock, { format: 'constraint', category: 'prefix', slot: 'script.constraint.prefix' });
  assert.match(preset.body, /不要在最终分镜中单独输出“统一风格”标题/);
});
