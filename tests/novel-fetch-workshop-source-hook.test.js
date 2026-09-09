const test = require('node:test');
const assert = require('node:assert/strict');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

function routeHandler(router, method, path) {
  const layer = router.stack.find(item => item.route?.path === path && item.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} missing`);
  return layer.route.stack.at(-1).handle;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function fixture({ sourceHook, withBatchRetry = false, withFallback = true } = {}) {
  const calls = [];
  const current = new Map([
    ['book-a', { meta: { bookId: 'book-a', maxTxt: 4000 } }],
    ['book-b', { meta: { bookId: 'book-b', maxTxt: 4000 } }]
  ]);
  const tasks = {
    async saveTasks(owner, rows) { calls.push(['saveTasks', owner, rows]); },
    async listTasks(owner) { calls.push(['listTasks', owner]); return [...current.values()]; },
    async getTask(owner, bookId) { calls.push(['getTask', owner, bookId]); return current.get(bookId) || null; },
  };
  if (withFallback) {
    tasks.fetchOriginal = async (owner, bookId, maxTxt) => {
      calls.push(['fallback', owner, bookId, maxTxt]);
      return { status: 'done' };
    };
  }
  if (withBatchRetry) {
    tasks.batchRetry = async (owner, ids, options) => {
      calls.push(['batchRetry', owner, ids]);
      await options.fetchOriginal(owner, ids[0], 4000);
      return { retried: ids.length };
    };
  }
  const router = createNovelFetchWorkshopRouter({
    auth: (_req, _res, next) => next(),
    tasks,
    configStore: {
      getConfig: () => ({ workflow: { auto_fetch_original: true, auto_rewrite_after_fetch: false }, fetch: { concurrency: 2, default_max_txt: 4000 }, rewrite: { default_ai_count: 1 } }),
      getPlatforms: () => [{ id: '2', name: '番茄付费' }],
      getStyles: () => []
    },
    parse: { parseBooks: () => ({ parsed: 2, emptyIdCount: 0, uniqueTasks: 2, duplicateCount: 0, tasks: [
      { bookId: 'book-a' },
      { bookId: 'book-b' }
    ] }) },
    classifier: { classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows, errors: [] }) },
    rewrite: { generateAiVersions: async () => ({ generated: [] }) },
    sourceHook
  });
  return { router, tasks, calls };
}

test('process uses the unified source hook for every book and keeps one book failure inside the batch', async () => {
  const hookCalls = [];
  const f = fixture({ sourceHook: async (owner, bookId, maxTxt) => {
    hookCalls.push([owner, bookId, maxTxt]);
    if (bookId === 'book-b') return { status: 'failed', code: 'SOURCE_FAILED' };
    return { status: 'done' };
  } });
  const handler = routeHandler(f.router, 'post', '/process');
  const res = response();
  await handler({ username: 'alice', body: { inputText: 'ignored' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(hookCalls, [['alice', 'book-a', 4000], ['alice', 'book-b', 4000]]);
  assert.equal(f.calls.some(([kind]) => kind === 'fallback'), false);
  assert.equal(res.body.fetched, 1);
  assert.equal(res.body.fetchFailed, 1);
});

test('batch retry and single fetch share the source hook when it is present', async () => {
  const hookCalls = [];
  const f = fixture({ withBatchRetry: true, sourceHook: async (...args) => {
    hookCalls.push(args);
    return { status: 'done' };
  } });
  const retry = response();
  await routeHandler(f.router, 'post', '/tasks/batch-retry')({ username: 'alice', body: { ids: ['book-a'] } }, retry);
  const single = response();
  await routeHandler(f.router, 'post', '/tasks/:bookId/fetch')({ username: 'alice', params: { bookId: 'book-b' }, body: {} }, single);
  assert.deepEqual(hookCalls, [['alice', 'book-a', 4000], ['alice', 'book-b', 4000]]);
  assert.equal(f.calls.some(([kind]) => kind === 'fallback'), false);
});

test('all three workshop fetch paths retain tasks.fetchOriginal when no source hook is configured', async () => {
  const f = fixture();
  const process = response();
  await routeHandler(f.router, 'post', '/process')({ username: 'alice', body: { inputText: 'ignored' } }, process);
  const retry = response();
  await routeHandler(f.router, 'post', '/tasks/batch-retry')({ username: 'alice', body: { ids: ['book-a'] } }, retry);
  const single = response();
  await routeHandler(f.router, 'post', '/tasks/:bookId/fetch')({ username: 'alice', params: { bookId: 'book-b' }, body: {} }, single);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'fallback').map(call => call.slice(1)), [
    ['alice', 'book-a', 4000],
    ['alice', 'book-b', 4000],
    ['alice', 'book-a', 4000],
    ['alice', 'book-b', 4000]
  ]);
});

test('batch retry still invokes the source hook when the injected task adapter has no legacy fallback method', async () => {
  const hookCalls = [];
  const f = fixture({ withBatchRetry: false, withFallback: false, sourceHook: async (...args) => {
    hookCalls.push(args);
    return { status: 'done' };
  } });
  const retry = response();
  await routeHandler(f.router, 'post', '/tasks/batch-retry')({ username: 'alice', body: { ids: ['book-a'] } }, retry);
  assert.deepEqual(hookCalls, [['alice', 'book-a', 4000]]);
  assert.equal(retry.statusCode, 200);
});
