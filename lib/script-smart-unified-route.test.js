const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSmartUnifiedStyleMessages,
  normalizeSmartUnifiedRequest
} = require('./script-smart-unified-route');

test('smart unified style stage receives the complete source and supporting entity facts', () => {
  const novelText = '第一段完整原文。第二段继续推进剧情。第三段切换到夜晚医院。';
  const messages = buildSmartUnifiedStyleMessages({
    novelText,
    characters: [{ 角色名称: '林夏', 身份: '医生' }],
    scenes: [{ 场景名称: '医院走廊', 时间: '夜晚' }]
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, new RegExp(novelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(messages[1].content, /林夏/);
  assert.match(messages[1].content, /医院走廊/);
});

test('smart unified system prompt defines H3 style.system fields and protects shot-level decisions', () => {
  const [system] = buildSmartUnifiedStyleMessages({ novelText: '一段足够分析视觉方向的原文。' });

  for (const key of [
    'final_genre', 'genre', 'trailer_style', 'story_era',
    'negative_prompt', 'picture_limit_prompt', 'quality_constraint_prompt'
  ]) {
    assert.match(system.content, new RegExp(key));
  }

  assert.match(system.content, /全片.*基线/);
  assert.match(system.content, /不得.*写入/);
  assert.match(system.content, /焦段/);
  assert.match(system.content, /时间码/);
  assert.match(system.content, /灯位/);
  assert.match(system.content, /只返回.*JSON/s);
});

test('smart unified user message defers its response schema to the selected system preset', () => {
  const messages = buildSmartUnifiedStyleMessages({
    novelText: '一段足够分析视觉方向的原文。',
    systemPrompt: '只返回 H3 的 final_genre、trailer_style、story_era 及四项约束字段 JSON。'
  });

  assert.match(messages[1].content, /系统预设.*输出协议/);
  assert.doesNotMatch(messages[1].content, /11 字段/);
  assert.doesNotMatch(messages[1].content, /imageMedium/);
});

test('smart unified request rejects empty source and caps supporting entity payloads', () => {
  assert.throws(() => normalizeSmartUnifiedRequest({ novelText: '   ' }), /原文/);

  const normalized = normalizeSmartUnifiedRequest({
    novelText: '正文',
    characters: Array.from({ length: 80 }, (_, index) => ({ name: `人物${index}` })),
    scenes: Array.from({ length: 80 }, (_, index) => ({ name: `场景${index}` }))
  });
  assert.equal(normalized.characters.length <= 40, true);
  assert.equal(normalized.scenes.length <= 40, true);
});
