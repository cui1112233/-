const test = require('node:test');
const assert = require('node:assert/strict');

const { createV78NovelFetchBatchExecutor } = require('../lib/novel-fetch-workshop/v2-batch-executor');

function baseStore(storage) {
  return {
    getConfig: async () => ({ storage, platforms: [], styles: [], workflow: { auto_fetch_original: false } }),
    getPlatforms: () => [],
    getStyles: () => [],
    listTasks: async () => [],
    deleteTasks: async () => ({ deleted: 0 })
  };
}

test('batch executor runs owner cleanup after a successful batch only when enabled', async () => {
  const calls = [];
  const reports = [];
  const executor = createV78NovelFetchBatchExecutor({
    accountResolver: owner => ({ username: owner }),
    createStore: () => baseStore({ cleanup_enabled: true, retention_days: 30 }),
    runBatch: async () => ({ fetched: 2 }),
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks }) => ({ tasks, errors: [] }),
    applyRules: async () => false,
    generateAiVersions: async () => ({ generated: [] }),
    runCleanup: async args => { calls.push(args); return { deleted: 2, deleteIds: ['1', '2'] }; },
    report: (_owner, event) => reports.push(event)
  });
  const result = await executor('alice', { input_text: '1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].owner, 'alice');
  assert.deepEqual(calls[0].policy, { cleanup_enabled: true, retention_days: 30 });
  assert.equal(result.cleanup.deleted, 2);
  assert.ok(reports.some(event => event.type === 'storage_cleanup' && event.status === 'done'));
});

test('cleanup failure is warning-only and does not fail the completed batch', async () => {
  const reports = [];
  const executor = createV78NovelFetchBatchExecutor({
    accountResolver: owner => ({ username: owner }),
    createStore: () => baseStore({ cleanup_enabled: true, retention_days: 30 }),
    runBatch: async () => ({ fetched: 1 }),
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks }) => ({ tasks, errors: [] }),
    applyRules: async () => false,
    generateAiVersions: async () => ({ generated: [] }),
    runCleanup: async () => { throw new Error('disk busy'); },
    report: (_owner, event) => reports.push(event)
  });
  const result = await executor('alice', { input_text: '1' });
  assert.equal(result.fetched, 1);
  assert.equal(result.cleanup_error, 'disk busy');
  assert.ok(reports.some(event => event.type === 'storage_cleanup' && event.status === 'warning'));
});
