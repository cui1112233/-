const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadRewriteWithLocalStubs() {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent?.filename?.endsWith('/lib/novel-fetch-workshop/rewrite.js')) {
      if (request === './ai') return { resolveAiSettings() {}, chatCompletion() {}, parseAiJsonContent() { return null; } };
      if (request === './mysql-store') return {
        normalizeNewlines: value => String(value || '').replace(/\r\n?/g, '\n'),
        dropEmptyLines: value => String(value || '').split('\n').filter(line => line.trim()).join('\n')
      };
      if (request === './rules') return { processConfiguredDocumentText: value => value };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../lib/novel-fetch-workshop/rewrite')];
    return require('../lib/novel-fetch-workshop/rewrite');
  } finally {
    Module._load = originalLoad;
  }
}

test('稀疏选择只生成 AI1 和 AI5，并使用各自方案及两类公共提示词', async () => {
  const { generateAiVersion } = loadRewriteWithLocalStubs();
  const { createTargetAwareAiGenerator } = require('../lib/novel-fetch-workshop/target-rewrite');
  const generateAiVersions = createTargetAwareAiGenerator({ generateAiVersion });
  const saved = [];
  const prompts = [];
  const logs = [];
  const meta = {
    bookId: 'book-1', originalStatus: 'done', targetVersions: ['original', 'ai1', 'ai5'],
    aiSlotMethodsSnapshot: { ai1: 'instruction', ai5: 'high_imitation' }, aiGeneratedVersions: []
  };
  const tasks = {
    async readOriginal() { return '第一行\n第二行'; },
    async readVersionText(_owner, _id, version) {
      return saved.find(item => item[0] === version)?.[1] || '';
    },
    async saveVersionText(_owner, _id, version, text) { saved.push([version, text]); },
    async getTask() { return { meta }; },
    async updateTaskMeta(_owner, _id, patch) { Object.assign(meta, patch); },
    async appendLog(_owner, _id, event, data) { logs.push([event, data]); }
  };
  const configStore = { getConfig: () => ({
    rewrite: { process_line_count: 1, anchor_line_count: 1, prompt: '改文提示词', processing_rule_prompt: '处理规则提示词' },
    knowledge: { usage_prompt: '知识库使用提示词' }
  }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'test-model', retry_times: 0 }),
    async chatCompletion(_settings, messages) { prompts.push(messages.map(item => item.content).join('\n')); return { text: '改写后的第一行' }; }
  };

  const result = await generateAiVersions({ configStore, tasks, username: 'alice', task: meta, ai });

  assert.equal(result.status, 'done');
  assert.deepEqual(saved.map(item => item[0]), ['ai1', 'ai5']);
  assert.deepEqual(meta.aiGeneratedVersions, ['ai1', 'ai5']);
  assert.equal(prompts.every(prompt => prompt.includes('处理规则提示词') && prompt.includes('知识库使用提示词')), true);
  assert.deepEqual(logs.filter(item => item[0] === 'ai_generated').map(item => item[1].strategy), ['instruction', 'high_imitation']);
});
