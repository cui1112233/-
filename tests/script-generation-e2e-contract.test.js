const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../routes/chat');

const store = { getPublished() { return null; }, listAll() { return []; } };
const body = extra => ({
  mode: 'continuous', format: 'storyboard', duration: '15s', novelText: '林夏推开门，看见顾言。',
  material: { version: 3, characters: [{ id: 'c1', name: '林夏（修改）', starred: true }], scenes: [{ id: 's1', name: '门口（新增）' }], visualStyle: '冷调', protagonistIds: ['c1'] },
  metaPrompts: { general: '标题协议' },
  constraints: { quality: { enabled: true, body: 'QUALITY_ONLY_AFTER' }, restriction: { enabled: true, body: 'RESTRICTION_ONLY_AFTER' }, negative: { enabled: true, body: 'NEGATIVE_ONLY_AFTER' } },
  ...extra
});

test('end-to-end request carries latest JSON material and two-call regeneration input', () => {
  const first = chat._private.buildScriptMessages(body(), store).map(item => item.content).join('\n');
  assert.match(first, /林夏（修改）/);
  assert.match(first, /门口（新增）/);
  assert.doesNotMatch(first, /QUALITY_ONLY_AFTER|RESTRICTION_ONLY_AFTER|NEGATIVE_ONLY_AFTER/);
  assert.doesNotMatch(first, /上一版分镜/);
  const regenerated = chat._private.buildScriptMessages(body({ previousOutput: '### 分镜一\n旧版' }), store).map(item => item.content).join('\n');
  assert.match(regenerated, /旧版/);
});

test('duration and titled output form stable card boundaries while post-processing stays local', () => {
  const messages = chat._private.buildScriptMessages(body(), store);
  assert.match(messages[0].content, /15s/);
  const output = '### 分镜一\n画面：开门\n### 分镜二\n画面：对视';
  const cards = output.split(/(?=### 分镜[一二三四五六七八九十])/).filter(Boolean);
  assert.equal(cards.length, 2);
});
