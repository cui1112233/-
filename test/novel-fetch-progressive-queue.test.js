const test = require('node:test');
const assert = require('node:assert/strict');

const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');
const { createNovelFetchQueue } = require('../lib/novel-fetch-workshop/queue');

function baseConfig() {
  return {
    workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: false, auto_submit_after_rewrite: false },
    fetch: { concurrency: 1 },
    rewrite: {}
  };
}

test('runner persists queued task metadata before classification starts', async () => {
  const events = [];
  const record = { meta: {} };
  const tasks = {
    async saveTasks(_owner, rows) { events.push(['save', rows.map(row => row.status)]); record.meta = { ...record.meta, ...rows[0] }; },
    async getTask() { return record; },
    async fetchOriginal() { events.push(['fetch']); return { status: 'done' }; },
    async readOriginal() { return ''; },
    async updateTaskMeta(_owner, _id, patch) { events.push(['update', patch]); record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };

  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1001\t排队书' },
    configStore: { getConfig: baseConfig, getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }] },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1001', bookName: '排队书' }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks: rows }) => { events.push(['classify']); return { tasks: rows }; },
    applyRules: async () => {},
    listTasks: async () => [record.meta]
  });

  assert.equal(events[0][0], 'save');
  assert.equal(events[0][1][0], 'queued');
});

test('runner reports each completed fetch before the next book finishes', async () => {
  const events = [];
  const tasks = {
    async saveTasks() { events.push(['save']); },
    async getTask(_owner, bookId) { return { meta: { bookId } }; },
    async fetchOriginal(_owner, bookId) { events.push(['fetch', bookId]); return { status: 'done' }; },
    async readOriginal() { return ''; },
    async updateTaskMeta() {},
    async listTasks() { return []; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1001\t一\n1002\t二' },
    configStore: { getConfig: baseConfig, getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }] },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1001' }, { bookId: '1002' }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows }),
    applyRules: async () => {},
    report: event => events.push(['report', event.type, event.book_id]),
    listTasks: async () => []
  });

  const firstReport = events.findIndex(item => item[0] === 'report' && item[1] === 'fetch' && item[2] === '1001');
  const secondFetch = events.findIndex(item => item[0] === 'fetch' && item[1] === '1002');
  assert.ok(firstReport >= 0 && secondFetch >= 0 && firstReport < secondFetch);
  assert.deepEqual(events.filter(item => item[0] === 'report' && item[1] === 'fetch').map(item => item[2]), ['1001', '1002']);
});

test('runner reports a fetch exception for the affected book immediately', async () => {
  const reports = [];
  const tasks = {
    async saveTasks() {},
    async getTask(_owner, bookId) { return { meta: { bookId } }; },
    async readOriginal() { return ''; },
    async fetchOriginal() { throw new Error('上游超时'); },
    async updateTaskMeta() {},
    async listTasks() { return []; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1003\t异常书' },
    configStore: { getConfig: baseConfig, getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }] },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1003' }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows }),
    report: event => reports.push(event),
    listTasks: async () => []
  });

  assert.equal(reports.find(event => event.type === 'fetch')?.status, 'failed');
  assert.equal(reports.find(event => event.type === 'fetch')?.book_id, '1003');
});

test('queue exposes active item and latest progress event while running', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const memory = { state: 'idle', items: [], events: [], updatedAt: '' };
  const store = {
    read: () => structuredClone(memory),
    load: () => structuredClone(memory),
    replace: (_owner, value) => Object.assign(memory, structuredClone(value))
  };
  const queue = createNovelFetchQueue({
    store,
    execute: async (_item, control) => {
      control.report({ stage: 'fetch', bookId: '1001', message: '原文处理中' });
      await gate;
      return { ok: true };
    }
  });

  queue.start('alice', [{ input_text: '1001\t队列书' }]);
  await new Promise(resolve => setTimeout(resolve, 10));
  const running = queue.status('alice');
  assert.equal(running.activeItemId, running.items[0].id);
  assert.equal(running.lastEvent.stage, 'fetch');
  release();
  await queue.waitForIdle('alice');
});

test('runner routes fetch rewrite and submit through the shared throughput controller', async () => {
  const stages = [];
  const record = { meta: { bookId: '1002', bookName: '受控书', aiCount: 1 }, document: {} };
  const tasks = {
    async saveTasks(_owner, rows) { record.meta = { ...record.meta, ...rows[0] }; },
    async getTask() { return record; },
    async fetchOriginal() { return { status: 'done' }; },
    async readOriginal() { return ''; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1002\t受控书' },
    configStore: {
      getConfig: () => ({
        workflow: { auto_classify_missing: false, auto_fetch_original: true, auto_rewrite_after_fetch: true, auto_submit_after_rewrite: true, auto_submit_confirmed: true },
        fetch: { concurrency: 1 }, ai: { max_concurrency: 1 }, rewrite: { default_ai_count: 1 }, web_submit: { enabled: true }
      }),
      getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }]
    },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1002', bookName: '受控书' }] }),
    generateAiVersions: async () => ({ status: 'done', generated: [{ version: 'ai1', status: 'done' }] }),
    submit: async () => ({ success_groups: 1, failed_groups: 0 }),
    throughput: { run: async (stage, work) => { stages.push(stage); return work(); } },
    listTasks: async () => [record.meta]
  });
  assert.deepEqual(stages, ['fetch', 'rewrite', 'submit']);
});
