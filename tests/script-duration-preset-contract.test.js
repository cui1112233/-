const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PRESETS, defaultBody } = require('../lib/system-preset-catalog');

test('published catalog defines exactly one 10s and one 15s duration preset', () => {
  const durations = SYSTEM_PRESETS.filter(item => item.protocolLock?.format === 'duration');
  assert.deepEqual(durations.map(item => item.id).sort(), ['script-duration-10s', 'script-duration-15s']);
  assert.equal(durations.find(item => item.id === 'script-duration-10s').protocolLock.duration, '10s');
  assert.equal(durations.find(item => item.id === 'script-duration-15s').protocolLock.duration, '15s');
  assert.match(defaultBody('script-duration-10s'), /严格覆盖 00:00-00:10/);
  assert.match(defaultBody('script-duration-15s'), /严格覆盖 00:00-00:15/);
});

test('duration presets are prompt rules, not code-generated settings', () => {
  for (const id of ['script-duration-10s', 'script-duration-15s']) {
    const preset = SYSTEM_PRESETS.find(item => item.id === id);
    assert.match(preset.body, /每个分镜/);
    assert.match(preset.body, /00:00-00:/);
    assert.doesNotMatch(preset.body, /质量|限制|负面提示词/);
  }
});
