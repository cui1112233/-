const SMART_UNIFIED_PREFIX_PRESET_ID = 'script-constraint-prefix-smart-unified';

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
    return '当前选择 15s 单元规则：每个独立分镜单元原则上大于 10 秒且不超过 15 秒；空间切换和最终收尾可以短于 10 秒。每个单元内部时间轴从 00:00 开始，并连续结束于该单元实际时长。';
  }
  return '当前选择 10s 单元规则：每个独立分镜单元不超过 10 秒；10s 模式无最低时长，空间切换或最终收尾可以是 8 秒、6 秒等短单元。每个单元内部时间轴从 00:00 开始，并连续结束于该单元实际时长。';
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

module.exports = {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  isSmartUnifiedPrefixEnabled,
  normalizeAudioTargetSeconds,
  buildStoryboardUnitDurationRules,
  buildAudioMatchRules
};
