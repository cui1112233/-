const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeKnowledgeSources } = require('../lib/novel-fetch-workshop/knowledge-recovery');

test('legacy entries recover a structured but empty account knowledge shell', () => {
  const accountKnowledge = {
    high_imitation: { items: [] },
    opening_phrases: { items: [] },
    rewrite_templates: { items: [] }
  };
  const legacyKnowledge = {
    high_imitation: { items: [{ id: 'hi_1' }] },
    opening_phrases: { items: [{ id: 'opening_1' }] },
    rewrite_templates: { items: [{ id: 'template_1' }] }
  };

  const merged = mergeKnowledgeSources(accountKnowledge, legacyKnowledge);

  assert.equal(merged.high_imitation.items.length, 1);
  assert.equal(merged.opening_phrases.items.length, 1);
  assert.equal(merged.rewrite_templates.items.length, 1);
});

test('account entries take precedence over legacy entries during knowledge recovery', () => {
  const merged = mergeKnowledgeSources(
    { high_imitation: { items: [{ id: 'account_1' }] } },
    { high_imitation: { items: [{ id: 'legacy_1' }] } }
  );

  assert.deepEqual(merged.high_imitation.items, [{ id: 'account_1' }]);
});

test('partial account knowledge keeps prompts while recovering missing legacy references', () => {
  const merged = mergeKnowledgeSources(
    { high_imitation: { prompts: [{ id: 'prompt_1' }], references: [] } },
    { high_imitation: { items: [{ id: 'legacy_1' }] } }
  );

  assert.deepEqual(merged.high_imitation.prompts, [{ id: 'prompt_1' }]);
  assert.deepEqual(merged.high_imitation.items, [{ id: 'legacy_1' }]);
});
