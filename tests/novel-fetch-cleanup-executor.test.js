const test = require('node:test');
const assert = require('node:assert/strict');

const { createV78NovelFetchBatchExecutor } = require('../lib/novel-fetch-workshop/v2-batch-executor');

function baseStore(storage) {
  return {
    getConfig: async () => ({ storage, platforms: [], styles: [], workflow: { auto_fetch_original: false } }),
    getPlatforms: () => [],
    getStyles: () => []
  };
}

test('batch executor runs owner body cleanup after a successful batch only when enabled', async () => {
  const calls = [];
  const reports = [];
  const executor = createV78NovelFetchBatchExecutor({
    accountResolver: owner => ({ username: owner }),
    createStore: () => baseStore({ cleanup_enabled: true, retention_days: 7 }),
    createLifecycleClient: ({ account }) => ({
      cleanupBodies: async (reason, limit) => {
        calls.push({ owner: account.username, reason, limit });
        return { deleted: 2, results: [{ bookId: '1', versionId: 'ai1' }, { bookId: '2', versionId: 'ai3' }] };
      }
    }),
    runBatch: async () => ({ fetched: 2 }),
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks }) => ({ tasks, errors: [] }),
    applyRules: async () => false,
    generateAiVersions: async () => ({ generated: [] }),
    report: (_owner, event) => reports.push(event)
  });
  const result = await executor('alice', { input_text: '1' });
  assert.deepEqual(calls, [{ owner: 'alice', reason: 'expired', limit: 100 }]);
  assert.equal(result.cleanup.deleted, 2);
  assert.ok(reports.some(event => event.type === 'storage_cleanup' && event.status === 'done' && /历史记录保留/.test(event.message)));
});

test('body cleanup failure is warning-only and does not fail the completed batch', async () => {
  const reports = [];
  const executor = createV78NovelFetchBatchExecutor({
    accountResolver: owner => ({ username: owner }),
    createStore: () => baseStore({ cleanup_enabled: true, retention_days: 7 }),
    createLifecycleClient: () => ({ cleanupBodies: async () => { throw new Error('body store busy'); } }),
    runBatch: async () => ({ fetched: 1 }),
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks }) => ({ tasks, errors: [] }),
    applyRules: async () => false,
    generateAiVersions: async () => ({ generated: [] }),
    report: (_owner, event) => reports.push(event)
  });
  const result = await executor('alice', { input_text: '1' });
  assert.equal(result.fetched, 1);
  assert.equal(result.cleanup_error, 'body store busy');
  assert.ok(reports.some(event => event.type === 'storage_cleanup' && event.status === 'warning'));
});
