const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('../routes/chat');

const store = { getPublished() { return null; }, listAll() { return []; } };
for (const duration of ['10s', '15s']) {
  test(`quick_director resolves the published ${duration} duration preset`, () => {
    const messages = chat._private.buildQuickDirectorMessages({ duration, novelText: '她推门。' }, store);
    const prompt = messages[0].content;
    assert.match(prompt, new RegExp(`严格覆盖 00:00-00:${duration === '15s' ? '15' : '10'}`));
  });
}

test('quick_director has no inline durationGuard assembly', () => {
  const source = fs.readFileSync(require.resolve('../routes/chat'), 'utf8');
  assert.doesNotMatch(source, /const durationGuard = `## 时长硬校验/);
  assert.match(source, /const durationPreset = resolveSystemPresetBody/);
});
