const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAiVersion } = require('../lib/novel-fetch-workshop/rewrite');

test('generateAiVersion records the active AI slot before calling the text model', async () => {
  const meta = { bookId: 'book-1', originalStatus: 'done', selectedVersions: ['ai1'] };
  const updates = [];
  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async updateTaskMeta(_username, _bookId, patch) { updates.push(patch); Object.assign(meta, patch); },
    async saveVersionText() {},
    async appendLog() {},
    async getTask() { return { meta }; }
  };
  const configStore = { getConfig: () => ({ rewrite: { process_line_count: 1, anchor_line_count: 1, method_sequence: ['instruction'], temperature: 0 } }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'text-test', retry_times: 0 }),
    async chatCompletion() {
      assert.equal(updates.at(-1).aiStatus, 'generating');
      assert.equal(updates.at(-1).aiCurrentVersion, 'ai1');
      return { text: '改写后的第一行' };
    }
  };

  const result = await generateAiVersion({ configStore, tasks, username: 'writer', task: meta, aiIndex: 1, ai });

  assert.equal(result.status, 'done');
  assert.equal(meta.aiStatus, 'done');
  assert.equal(meta.aiCurrentVersion, '');
});

test('generateAiVersion reloads a fresh fetched original instead of trusting a stale batch snapshot', async () => {
  const storedMeta = { bookId: 'book-2', originalStatus: 'done', selectedVersions: ['ai1'] };
  const staleTask = { bookId: 'book-2', originalStatus: 'created', selectedVersions: ['ai1'] };
  const updates = [];
  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async updateTaskMeta(_username, _bookId, patch) { updates.push(patch); Object.assign(storedMeta, patch); },
    async saveVersionText() {},
    async appendLog() {},
    async getTask() { return { meta: storedMeta }; }
  };
  const configStore = { getConfig: () => ({ rewrite: { process_line_count: 1, anchor_line_count: 1, method_sequence: ['instruction'], temperature: 0 } }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'text-test', retry_times: 0 }),
    async chatCompletion() { return { text: '改写后的第一行' }; }
  };

  const result = await generateAiVersion({ configStore, tasks, username: 'writer', task: staleTask, aiIndex: 1, ai });

  assert.equal(result.status, 'done');
  assert.equal(updates.some(patch => patch.aiStatus === 'generating'), true);
});
