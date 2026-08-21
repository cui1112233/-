const express = require('express');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchRewriteRouter } = require('../routes/batch-rewrite');

async function request(app, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('批量改文从账户设置汇总已保存的三大知识库', async () => {
  const savedKnowledge = {
    high_imitation: { prompts: [{ id: 'prompt-1' }], references: [] },
    opening_phrases: { styles: ['现代', '古风'], items: [{ id: 'opening-1' }, { id: 'opening-2' }] },
    rewrite_templates: { profiles: [{ id: 'template-1' }], temporary_instructions: [{ id: 'instruction-1' }] },
    layout_rules: {},
    symbol_rules: { symbol_rules: [{ find: 'A' }], pair_fill_rules: [{ left: '"', right: '"' }] },
    chapter_rules: { chapter_exact_rules: [{ find: '第1章' }], chapter_inline_rules: [{ find: '第2章' }, { find: '第3章' }] }
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; req.auth = { account: { username: 'writer-a', isOwner: false } }; next(); },
    knowledgeStore: { list: () => ({}), getSummary: () => ({}) },
    openingStore: {},
    tasksFactory: async () => ({
      tasks: {},
      config: { knowledge: savedKnowledge, platforms: [], styles: [] },
      configStore: { getConfig: () => ({}), getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const config = await request(app, '/api/batch-rewrite/config');
  assert.equal(config.status, 200);
  assert.deepEqual(config.body.knowledge_summary, {
    opening_phrases: 2,
    opening_styles: 2,
    rewrite_profiles: 1,
    temporary_instructions: 1,
    high_imitation_prompts: 1,
    high_imitation_references: 0,
    sensitive_rules: 0,
    symbol_rules: 1,
    pair_fill_rules: 1,
    chapter_exact_rules: 1,
    chapter_inline_rules: 2
  });

  const refreshed = await request(app, '/api/batch-rewrite/knowledge');
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.summary.opening_phrases, 2);
  assert.equal(refreshed.body.summary.rewrite_profiles, 1);
});
