const assert = require('node:assert/strict');
const test = require('node:test');

const chat = require('../routes/chat');
const store = { getPublished() { return null; }, listAll() { return []; } };

function build(extra = {}) {
  return chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '15s', novelText: '她推开门。',
    material: {
      version: 2,
      characters: [{ id: 'c-1', name: '林夏' }],
      scenes: [{ id: 's-1', name: '门口' }],
      visualStyle: '冷调电影感', protagonistIds: ['c-1']
    },
    metaPrompts: { general: '每个分镜以标题开头' },
    constraints: {
      quality: { enabled: true, body: 'QUALITY_SENTINEL' },
      restriction: { enabled: true, body: 'RESTRICTION_SENTINEL' },
      negative: { enabled: true, body: 'NEGATIVE_SENTINEL' }
    },
    ...extra
  }, store);
}

test('lightweight request sends current material and starred protagonist', () => {
  const messages = build();
  const text = messages.map(item => item.content).join('\n');
  assert.match(text, /林夏/);
  assert.match(text, /冷调电影感/);
  assert.match(text, /主角白名单/);
  assert.match(text, /每个分镜以标题开头/);
});

test('quality, restriction and negative prompts stay out of model request', () => {
  const text = build().map(item => item.content).join('\n');
  assert.doesNotMatch(text, /QUALITY_SENTINEL|RESTRICTION_SENTINEL|NEGATIVE_SENTINEL/);
});

test('previous output is conditional and only included for regeneration', () => {
  assert.doesNotMatch(build().map(item => item.content).join('\n'), /上一版分镜/);
  assert.match(build({ previousOutput: '旧版内容' }).map(item => item.content).join('\n'), /旧版内容/);
});

test('duration is resolved from the request preset value', () => {
  assert.match(build()[0].content, /15s/);
});

test('legacy requests without authoritative material retain constraint behavior', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '旧调用',
    characters: [], scenes: [], protagonists: [],
    constraints: { quality: { enabled: true, source: 'draft', body: 'LEGACY_QUALITY' } }
  }, store);
  assert.match(messages[0].content, /LEGACY_QUALITY/);
});
