const test = require('node:test');
const assert = require('node:assert/strict');

const { createV78NovelFetchBatchExecutor, createConfigStoreSnapshot } = require('../lib/novel-fetch-workshop/v2-batch-executor');

test('executor resolves owner, creates owner-scoped store, and delegates to the shared runner', async () => {
  const calls = [];
  const account = { username: 'alice', isOwner: false };
  const tasks = {
    getConfig: async () => ({ platforms: [{ id: '15', name: '知乎' }], styles: ['现代'], ai: { model: 'm' }, ai_presets: [], ai_assignments: {} }),
    getPlatforms: () => [{ id: 'fallback' }],
    getStyles: () => ['fallback']
  };
  const execute = createV78NovelFetchBatchExecutor({
    accountResolver: owner => owner === 'alice' ? account : null,
    createStore: options => { calls.push(['store', options]); return tasks; },
    runBatch: async options => {
      calls.push(['run', options]);
      assert.equal(options.username, 'alice');
      assert.deepEqual(options.payload, { input_text: 'A' });
      assert.equal(options.tasks, tasks);
      assert.deepEqual(options.configStore.getPlatforms(), [{ id: '15', name: '知乎' }]);
      assert.deepEqual(options.configStore.getStyles(), ['现代']);
      return { fetched: 1 };
    },
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows, errors: [] }),
    applyRules: async () => {},
    generateAiVersions: async () => ({ generated: [] }),
    targetBaseUrl: 'http://go:4000',
    bridgeSecret: 'secret'
  });

  assert.deepEqual(await execute('alice', { input_text: 'A' }), { fetched: 1 });
  assert.equal(calls[0][0], 'store');
  assert.equal(calls[0][1].account, account);
  assert.equal(calls[0][1].targetBaseUrl, 'http://go:4000');
  assert.equal(calls[0][1].bridgeSecret, 'secret');
});

test('missing owner is non-recoverable so queue does not retry invalid accounts', async () => {
  const execute = createV78NovelFetchBatchExecutor({
    accountResolver: () => null,
    createStore: () => { throw new Error('must not create store'); },
    runBatch: async () => ({}),
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks }) => ({ tasks, errors: [] }),
    applyRules: async () => {},
    generateAiVersions: async () => ({ generated: [] })
  });
  await assert.rejects(() => execute('ghost', { input_text: 'A' }), error => {
    assert.equal(error.recoverable, false);
    assert.match(error.message, /账号/);
    return true;
  });
});

test('config snapshot exposes synchronous runner/classifier getters without losing AI assignments', () => {
  const tasks = { getPlatforms: () => [{ id: '2' }], getStyles: () => ['现代'] };
  const snapshot = createConfigStoreSnapshot(tasks, { ai: { model: 'm' }, ai_presets: [{ id: 'p' }], ai_assignments: { classifier: 'p' } });
  assert.deepEqual(snapshot.getPlatforms(), [{ id: '2' }]);
  assert.deepEqual(snapshot.getStyles(), ['现代']);
  assert.deepEqual(snapshot.getAiConfig(), { ai: { model: 'm' }, ai_presets: [{ id: 'p' }], ai_assignments: { classifier: 'p' } });
});
