const test = require('node:test');
const assert = require('node:assert/strict');

const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');

function registry() {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = (path, handler) => { routes.set(`${method.toUpperCase()} ${path}`, handler); return router; };
  return { router, routes };
}

async function call(handler, { body = {}, params = {}, query = {} } = {}) {
  const out = { statusCode: 200, body: undefined };
  const res = { status(code) { out.statusCode = code; return this; }, json(value) { out.body = value; return value; } };
  await handler({ username: 'alice', body, params, query }, res, error => { if (error) throw error; });
  return out;
}

function queueFixture(calls) {
  return {
    start(owner, payloads) { calls.push(['start', owner, payloads]); return { state: 'running', items: payloads.map((payload, i) => ({ id: `job-${i + 1}`, state: 'queued', payload })) }; },
    pause() { return {}; }, resume() { return {}; }, stop() { return {}; }, status() { return { state: 'idle', items: [] }; }
  };
}

test('process preview delegates to parser-backed task ops without starting queue', async () => {
  const calls = [];
  const taskOps = { async previewInput(owner, body) { calls.push(['preview', owner, body]); return { unique_tasks: 2, tasks: [{ book_id: '1' }, { book_id: '2' }] }; } };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue: queueFixture(calls), scheduler: { list: () => [] }, taskOps });
  const result = await call(routes.get('POST /process/preview'), { body: { input_text: 'x' } });
  assert.equal(result.body.unique_tasks, 2);
  assert.deepEqual(calls, [['preview', 'alice', { input_text: 'x' }]]);
});

test('existing batch-retry route is intercepted by V2 checkpoint payloads', async () => {
  const calls = [];
  const taskOps = {
    async prepareRetryPayloads(owner, ids) { calls.push(['prepare', owner, ids]); return ids.map(id => ({ input_text: id, retry_existing_task: true, target_versions: ['ai1', 'ai5'] })); },
    async abnormalIds(owner) { calls.push(['abnormal', owner]); return ['failed-a']; },
    async list() { return [{ id: 'failed-a', status: 'queued' }]; }
  };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue: queueFixture(calls), scheduler: { list: () => [] }, taskOps });

  const selected = await call(routes.get('POST /tasks/batch-retry'), { body: { mode: 'selected', ids: ['a'] } });
  assert.equal(selected.body.retried, 1);
  assert.deepEqual(calls[1][2][0].target_versions, ['ai1', 'ai5']);
  assert.equal(Object.hasOwn(calls[1][2][0], 'batch_id'), false);

  calls.length = 0;
  const failed = await call(routes.get('POST /tasks/batch-retry'), { body: { mode: 'failed' } });
  assert.equal(failed.body.retried, 1);
  assert.deepEqual(calls[0], ['abnormal', 'alice']);
  assert.deepEqual(calls[1], ['prepare', 'alice', ['failed-a']]);
});

test('task detail route returns target-aware sparse content from task ops', async () => {
  const taskOps = { async detail(_owner, id) { return id === 'a' ? { meta: { id: 'a' }, ai_texts: [{ name: 'AI1' }, { name: 'AI5' }] } : null; } };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue: queueFixture([]), scheduler: { list: () => [] }, taskOps });
  const found = await call(routes.get('GET /tasks/:id'), { params: { id: 'a' } });
  assert.deepEqual(found.body.ai_texts.map(item => item.name), ['AI1', 'AI5']);
  const missing = await call(routes.get('GET /tasks/:id'), { params: { id: 'missing' } });
  assert.equal(missing.statusCode, 404);
});
