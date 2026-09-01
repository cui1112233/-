const test = require('node:test');
const assert = require('node:assert/strict');

const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');

function registry() {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, handler) => { routes.set(`${method.toUpperCase()} ${path}`, handler); return router; };
  }
  return { router, routes };
}

async function call(handler, { username = 'alice', body = {}, params = {}, query = {} } = {}) {
  const response = { statusCode: 200, body: undefined };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(value) { response.body = value; return value; }
  };
  await handler({ username, body, params, query }, res, error => { if (error) throw error; });
  return response;
}

function baseQueue() {
  return {
    start() { return { state: 'running', items: [] }; },
    pause() { return { state: 'paused', items: [] }; },
    resume() { return { state: 'running', items: [] }; },
    stop() { return { state: 'stopping', items: [] }; },
    status() { return { state: 'idle', items: [], events: [], updatedAt: '' }; }
  };
}

test('V2 API exposes current/history/rerun batch routes without auto-starting rerun', async () => {
  const calls = [];
  const batches = {
    current(owner) { calls.push(['current', owner]); return { id: 'batch-current' }; },
    list(owner) { calls.push(['list', owner]); return [{ id: 'batch-old' }, { id: 'batch-current' }]; },
    prepareRerun(owner, id, mode) {
      calls.push(['rerun', owner, id, mode]);
      return {
        source_batch_id: id,
        mode,
        input_snapshot: '10000000001\tA',
        settings_snapshot: { target_versions: ['ai1', 'ai3'] },
        preselected_book_ids: ['10000000001'],
        payload: { input_text: '10000000001\tA', source_batch_id: id }
      };
    }
  };
  let starts = 0;
  const queue = baseQueue();
  queue.start = () => { starts += 1; return { state: 'running', items: [] }; };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler: { list: () => [] }, batches });

  assert.ok(routes.has('GET /batches/current'));
  assert.ok(routes.has('GET /batches'));
  assert.ok(routes.has('POST /batches/:id/rerun'));

  const current = await call(routes.get('GET /batches/current'));
  assert.equal(current.body.batch.id, 'batch-current');
  const history = await call(routes.get('GET /batches'));
  assert.deepEqual(history.body.batches.map(item => item.id), ['batch-old', 'batch-current']);
  const rerun = await call(routes.get('POST /batches/:id/rerun'), {
    params: { id: 'batch-old' }, body: { mode: 'abnormal' }
  });
  assert.equal(rerun.statusCode, 200);
  assert.equal(rerun.body.source_batch_id, 'batch-old');
  assert.deepEqual(rerun.body.preselected_book_ids, ['10000000001']);
  assert.equal(starts, 0, '历史重跑只能回填处理页，不能自动启动队列');
  assert.deepEqual(calls, [
    ['current', 'alice'],
    ['list', 'alice'],
    ['rerun', 'alice', 'batch-old', 'abnormal']
  ]);
});

test('missing historical batch rerun returns 404', async () => {
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, {
    queue: baseQueue(), scheduler: { list: () => [] },
    batches: { current: () => null, list: () => [], prepareRerun: () => null }
  });
  const response = await call(routes.get('POST /batches/:id/rerun'), { params: { id: 'missing' }, body: { mode: 'all' } });
  assert.equal(response.statusCode, 404);
});

test('tasks stop-selected delegates only selected task ids and does not stop the whole queue', async () => {
  const calls = [];
  const queue = baseQueue();
  queue.stop = owner => { calls.push(['queue-stop', owner]); return { state: 'stopping', items: [] }; };
  const taskOps = {
    async cancelSelected(owner, ids) { calls.push(['cancel-selected', owner, ids]); return { updated: ids.length, missing: [], status: 'cancelled' }; }
  };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler: { list: () => [] }, taskOps });

  assert.ok(routes.has('POST /tasks/stop-selected'));
  const response = await call(routes.get('POST /tasks/stop-selected'), { body: { ids: ['10000000001', '10000000003'] } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.updated, 2);
  assert.deepEqual(calls, [['cancel-selected', 'alice', ['10000000001', '10000000003']]]);
});
