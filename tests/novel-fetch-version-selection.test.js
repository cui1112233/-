const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VERSION_ORDER,
  normalizeSelectedVersions,
  selectedAiIndices,
  normalizeAiSlotMethods,
  normalizeProfileBindings
} = require('../lib/novel-fetch-workshop/version-selection');

test('版本选择保留 AI1+AI5 这种非连续组合，并按固定顺序去重', () => {
  assert.deepEqual(VERSION_ORDER, ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.deepEqual(normalizeSelectedVersions(['AI5', 'ai1', 'ai5', 'bad']), ['ai1', 'ai5']);
  assert.deepEqual(selectedAiIndices(['original', 'ai1', 'ai5']), [1, 5]);
});

test('未传版本时使用明确的安全默认值，而不是 AI 数量', () => {
  assert.deepEqual(normalizeSelectedVersions(), ['original', 'ai1']);
  assert.deepEqual(normalizeSelectedVersions([], ['original']), ['original']);
});

test('每个 AI 槽位独立保存处理方案，只接受三种合法方案', () => {
  assert.deepEqual(normalizeAiSlotMethods({
    ai1: 'instruction',
    ai2: 'opening_instruction',
    ai5: 'high_imitation',
    ai3: 'not-valid',
    ai6: 'instruction'
  }), {
    ai1: 'instruction',
    ai2: 'opening_instruction',
    ai5: 'high_imitation'
  });
});

test('版本对应 121 配置档覆盖原文和 AI1-AI5', () => {
  assert.deepEqual(normalizeProfileBindings({
    original: 'profile-original',
    ai1: 'profile-one',
    ai4: 'profile-four',
    ai5: 'profile-five',
    ai6: 'ignored'
  }), {
    original: 'profile-original',
    ai1: 'profile-one',
    ai4: 'profile-four',
    ai5: 'profile-five'
  });
});
