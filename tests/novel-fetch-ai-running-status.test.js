const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAiVersion, reconcileAiTaskStatus } = require('../lib/novel-fetch-workshop/rewrite');

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

test('generateAiVersion rejects provider safety-policy text instead of saving it as AI copy', async () => {
  const meta = { bookId: 'book-policy', originalStatus: 'done', selectedVersions: ['ai1'] };
  const updates = [];
  let saved = false;
  const logs = [];
  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async updateTaskMeta(_username, _bookId, patch) { updates.push(patch); Object.assign(meta, patch); },
    async saveVersionText() { saved = true; },
    async appendLog(_username, _bookId, event, data) { logs.push({ event, data }); },
    async getTask() { return { meta }; }
  };
  const configStore = { getConfig: () => ({ rewrite: { process_line_count: 1, anchor_line_count: 1, method_sequence: ['instruction'], temperature: 0 } }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'text-test', retry_times: 0 }),
    async chatCompletion() {
      return { text: "The prompt could not be submitted. The prompt contains sensitive words that violate Google's [Generative AI Prohibited Use policy]." };
    }
  };

  const result = await generateAiVersion({ configStore, tasks, username: 'writer', task: meta, aiIndex: 1, ai });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'AI接口拒绝了该提示词（内容安全策略）');
  assert.equal(saved, false);
  assert.equal(meta.aiStatus, 'failed');
  assert.equal(meta.aiError, 'AI接口拒绝了该提示词（内容安全策略）');
  assert.equal(logs.at(-1).event, 'ai_generate_failed');
  assert.equal(logs.at(-1).data.responseMode, 'refusal');
});

test('generateAiVersion reuses an existing AI1 without spending another model call', async () => {
  const meta = { bookId: 'book-existing', originalStatus: 'done', selectedVersions: ['ai1'], aiStatus: 'failed', aiError: 'insufficient balance' };
  let calls = 0;
  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async readVersionText(_username, _bookId, version) { return version === 'ai1' ? '已经保存的 AI1 文案' : ''; },
    async updateTaskMeta(_username, _bookId, patch) { Object.assign(meta, patch); },
    async appendLog() {},
    async getTask() { return { meta }; }
  };
  const configStore = { getConfig: () => ({ rewrite: { process_line_count: 1, anchor_line_count: 1, method_sequence: ['instruction'], temperature: 0 } }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'text-test', retry_times: 0 }),
    async chatCompletion() { calls += 1; throw new Error('insufficient balance'); }
  };

  const result = await generateAiVersion({ configStore, tasks, username: 'writer', task: meta, aiIndex: 1, ai });

  assert.equal(result.status, 'done');
  assert.equal(result.reused, true);
  assert.equal(calls, 0);
  assert.equal(meta.aiStatus, 'done');
  assert.equal(meta.aiError, '');
});

test('generateAiVersion preserves an existing AI1 as partial when AI2 fails', async () => {
  const meta = { bookId: 'book-partial', originalStatus: 'done', selectedVersions: ['ai1', 'ai2'], aiStatus: 'done', aiGeneratedVersions: ['ai1'] };
  const tasks = {
    async readOriginal() { return '原文第一行\n原文第二行'; },
    async readVersionText(_username, _bookId, version) { return version === 'ai1' ? '已经保存的 AI1 文案' : ''; },
    async updateTaskMeta(_username, _bookId, patch) { Object.assign(meta, patch); },
    async appendLog() {},
    async getTask() { return { meta }; }
  };
  const configStore = { getConfig: () => ({ rewrite: { process_line_count: 1, anchor_line_count: 1, method_sequence: ['instruction'], temperature: 0 } }) };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://example.test', model: 'text-test', retry_times: 0 }),
    async chatCompletion() { throw new Error('insufficient balance'); }
  };

  const result = await generateAiVersion({ configStore, tasks, username: 'writer', task: meta, aiIndex: 2, ai });

  assert.equal(result.status, 'partial');
  assert.equal(meta.aiStatus, 'partial');
  assert.deepEqual(meta.aiGeneratedVersions, ['ai1']);
  assert.equal(meta.aiError, 'insufficient balance');
});

test('reconcileAiTaskStatus repairs a historical AI1 failure without model invocation', async () => {
  const meta = { bookId: 'book-history', selectedVersions: ['ai1'], aiStatus: 'failed', aiError: 'insufficient balance', aiGeneratedVersions: [] };
  const logs = [];
  const tasks = {
    async readVersionText(_username, _bookId, version) { return version === 'ai1' ? '已保存的历史 AI1' : ''; },
    async getTask() { return { meta }; },
    async updateTaskMeta(_username, _bookId, patch) { Object.assign(meta, patch); },
    async appendLog(_username, _bookId, event, data) { logs.push({ event, data }); }
  };

  const repaired = await reconcileAiTaskStatus({ tasks, username: 'writer', bookId: meta.bookId, task: meta, recordLog: true });
  const repeated = await reconcileAiTaskStatus({ tasks, username: 'writer', bookId: meta.bookId, task: meta, recordLog: true });

  assert.equal(repaired.status, 'done');
  assert.equal(repaired.changed, true);
  assert.equal(meta.aiStatus, 'done');
  assert.equal(meta.aiError, '');
  assert.equal(meta.aiLastAttemptError, 'insufficient balance');
  assert.equal(logs.filter(item => item.event === 'ai_status_reconciled').length, 1);
  assert.equal(repeated.changed, false);
});
