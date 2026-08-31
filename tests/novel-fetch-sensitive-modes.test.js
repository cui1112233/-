const test = require('node:test');
const assert = require('node:assert/strict');
const { processSensitiveText } = require('../lib/novel-fetch-workshop/sensitive');

const keywords = [{ find: '坏词', replace: '合规词', enabled: true, apply_to_original: true, apply_to_ai: true }];

function settings(mode) {
  return { mode, enabled: mode !== 'replace', keywords, scope: 'original', retries: 0, concurrency: 4, context_chars: 0, max_hits: 20, aiSettings: {} };
}

test('replace mode never calls AI', async () => {
  let calls = 0;
  const result = await processSensitiveText({ text: '甲坏词。乙坏词。', settings: settings('replace'), ai: { chatCompletion: async () => { calls += 1; } } });
  assert.equal(calls, 0);
  assert.equal(result.text, '甲合规词。乙合规词。');
  assert.equal(result.mode, 'replace');
});

test('ai_each repairs each hit independently', async () => {
  let calls = 0;
  const result = await processSensitiveText({
    text: '甲坏词。乙坏词。', settings: settings('ai_each'),
    ai: { chatCompletion: async () => ({ text: `修复${++calls}` }) }
  });
  assert.equal(calls, 2);
  assert.equal(result.mode, 'ai_each');
  assert.equal(result.fixedItems.length, 2);
  assert.ok(result.fixedItems.every(item => item.fallback_from_ai === false));
});

test('ai_group sends all hits in one AI request', async () => {
  let calls = 0;
  const result = await processSensitiveText({
    text: '甲坏词。乙坏词。', settings: settings('ai_group'),
    ai: { chatCompletion: async () => { calls += 1; return { text: JSON.stringify({ items: [{ hit_index: 1, fixed_text: '甲合规。' }, { hit_index: 2, fixed_text: '乙合规。' }] }) }; } }
  });
  assert.equal(calls, 1);
  assert.equal(result.mode, 'ai_group');
  assert.equal(result.fixedItems.length, 2);
  assert.equal(result.text, '甲合规。乙合规。');
});

test('AI failure falls back explicitly and records fallback_from_ai', async () => {
  const result = await processSensitiveText({
    text: '甲坏词。', settings: settings('ai_each'),
    ai: { chatCompletion: async () => { throw new Error('boom'); } }
  });
  assert.equal(result.fixedItems[0].status, 'fallback');
  assert.equal(result.fixedItems[0].fallback_from_ai, true);
  assert.equal(result.text, '甲合规词。');
});
