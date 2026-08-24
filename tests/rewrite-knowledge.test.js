const { test } = require('node:test');
const assert = require('node:assert');
const {
  methodForAiIndex,
  resolveRewriteKnowledge,
  buildRewriteMessages,
  buildHighImitationMessages
} = require('../lib/novel-fetch-workshop/rewrite');

const task = { bookId: '100', bookName: '测试书', style: '现代女主', gender: '女频' };
const config = {
  rewrite: {
    prompt: '基础提示词',
    default_template_id: 'template-a',
    opening_phrase_mode: 'auto',
    high_imitation_mode: 'auto',
    ai_slot_methods: { ai1: 'opening_instruction', ai2: 'high_imitation' }
  },
  knowledge: {
    rewrite_templates: { profiles: [{ id: 'template-a', name: '都市模板', style: '现代女主', prompt: '模板：{book_name}' }] },
    opening_phrases: { items: [{ id: 'opening-a', style: '现代女主', text: '先给冲突，再揭悬念。' }] },
    high_imitation: {
      prompts: [{ id: 'prompt-a', style: '现代女主', prompt: '高仿时保持短句节奏。' }],
      references: [{ id: 'reference-a', style: '现代女主', title: '参考开头', content: '她推开门，所有人都沉默了。' }]
    }
  }
};

test('AI 槽位优先于轮换方案', () => {
  assert.equal(methodForAiIndex(['instruction'], 1, config.rewrite.ai_slot_methods), 'opening_instruction');
  assert.equal(methodForAiIndex(['instruction'], 2, config.rewrite.ai_slot_methods), 'high_imitation');
  assert.equal(methodForAiIndex(['instruction'], 3, config.rewrite.ai_slot_methods), 'instruction');
});

test('改文模板、爆款开头与高仿参考会进入对应模型消息', () => {
  const knowledge = resolveRewriteKnowledge(config, task, 1);
  assert.equal(knowledge.template.name, '都市模板');
  assert.equal(knowledge.openingPhrase.id, 'opening-a');
  assert.equal(knowledge.highReference.id, 'reference-a');

  const openingMessages = buildRewriteMessages({ strategy: 'opening_instruction', config, task, targetLines: ['原文一'], anchorLines: ['原文二'], fullText: '原文一\n原文二', aiIndex: 1, knowledge });
  assert.match(openingMessages[0].content, /模板：测试书/);
  assert.match(openingMessages[1].content, /先给冲突/);

  const highMessages = buildHighImitationMessages({ config, task, targetLines: ['原文一'], anchorLines: [], fullText: '原文一', aiIndex: 2, knowledge });
  assert.match(highMessages[0].content, /高仿时保持短句节奏/);
  assert.match(highMessages[1].content, /她推开门/);
});
