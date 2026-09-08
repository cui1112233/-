'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rewrite = require('../lib/novel-fetch-workshop/rewrite');

test('generateAiVersions only generates the selected sparse AI versions and honors per-task slot methods', async () => {
  const savedVersions = [];
  const logs = [];
  const meta = {
    bookId: 'book-1',
    bookName: '测试书',
    originalStatus: 'done',
    aiStatus: '',
    aiGeneratedCount: 0,
    style: '都市',
    gender: '男'
  };

  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async getTask() { return { meta }; },
    async updateTaskMeta(_username, _bookId, patch) { Object.assign(meta, patch); },
    async saveVersionText(_username, _bookId, version, text) { savedVersions.push({ version, text }); },
    async appendLog(_username, _bookId, event, data) { logs.push({ event, data }); }
  };

  const config = {
    rewrite: {
      process_line_count: 1,
      anchor_line_count: 0,
      method_sequence: ['high_imitation', 'opening_instruction', 'instruction'],
      temperature: 0.2
    },
    knowledge: {},
    layout: {}
  };
  const configStore = {
    getConfig() { return config; },
    getAiConfig() { return { ai: {}, ai_presets: [], ai_assignments: {} }; }
  };
  const ai = {
    resolveAiSettings() { return { baseUrl: 'http://example.invalid', model: 'test-model', retry_times: 0 }; },
    async chatCompletion() { return { text: '改写后的第一行' }; }
  };

  const result = await rewrite.generateAiVersions({
    configStore,
    tasks,
    username: 'tester',
    task: meta,
    aiIndexes: [2, 5],
    slotMethods: {
      ai2: 'opening_instruction',
      ai5: 'instruction'
    },
    ai
  });

  assert.equal(result.status, 'done');
  assert.deepEqual(savedVersions.map(item => item.version), ['ai2', 'ai5']);
  assert.equal(result.generated.length, 2);
  assert.deepEqual(
    logs.filter(item => item.event === 'ai_generated').map(item => [item.data.aiIndex, item.data.strategy]),
    [[2, 'opening_instruction'], [5, 'instruction']]
  );
});
