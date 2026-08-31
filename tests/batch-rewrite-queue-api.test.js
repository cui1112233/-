const test = require('node:test');
const assert = require('node:assert/strict');

const { registerNovelFetchV2Routes, buildRealtimeStatus } = require('../lib/novel-fetch-workshop/v2-api-contract');

function registry() {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, handler) => { routes.set(`${method.toUpperCase()} ${path}`, handler); return router; };
  }
  return { router, routes };
}

async function call(handler, { username = 'alice', body = {}, params = {} } = {}) {
  const response = { statusCode: 200, body: undefined };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(value) { response.body = value; return value; }
  };
  await handler({ username, body, params }, res);
  return response;
}

test('queue routes use req.username and expose real queue state', async () => {
  const calls = [];
  const queue = {
    start(owner, items) { calls.push(['start', owner, items]); return { state: 'running', items }; },
    pause(owner) { calls.push(['pause', owner]); return { state: 'paused', items: [] }; },
    resume(owner) { calls.push(['resume', owner]); return { state: 'running', items: [] }; },
    stop(owner) { calls.push(['stop', owner]); return { state: 'stopping', items: [] }; },
    status(owner) { calls.push(['status', owner]); return { state: 'idle', items: [], events: [], updatedAt: '' }; }
  };
  const scheduler = { list: () => [] };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler });

  assert.ok(routes.has('POST /process/queue/start'));
  assert.ok(routes.has('POST /process/queue/pause'));
  assert.ok(routes.has('POST /process/queue/resume'));
  assert.ok(routes.has('POST /process/queue/stop'));
  assert.ok(routes.has('GET /process/queue/status'));
  assert.ok(routes.has('GET /realtime/status'));

  const started = await call(routes.get('POST /process/queue/start'), { body: { items: [{ input_text: 'A' }] } });
  assert.equal(started.statusCode, 200);
  assert.equal(started.body.state, 'running');
  assert.deepEqual(calls[0], ['start', 'alice', [{ input_text: 'A' }]]);

  await call(routes.get('POST /process/queue/pause'));
  await call(routes.get('POST /process/queue/resume'));
  await call(routes.get('POST /process/queue/stop'));
  const status = await call(routes.get('GET /process/queue/status'));
  assert.deepEqual(status.body, { state: 'idle', items: [], events: [], updatedAt: '' });
  assert.ok(calls.every(entry => entry[1] === 'alice'));
});

test('realtime status is derived only from persisted queue items', () => {
  const value = buildRealtimeStatus({
    state: 'running',
    items: [
      { state: 'queued' }, { state: 'running' }, { state: 'done' }, { state: 'failed' }, { state: 'waiting_retry' }
    ],
    events: [], updatedAt: '2026-08-31T10:00:00.000Z'
  }, [{ id: 's1', status: 'scheduled' }]);
  assert.equal(value.active, true);
  assert.deepEqual(value.counts, { total: 5, queued: 1, running: 1, waiting_retry: 1, done: 1, failed: 1, stopped: 0 });
  assert.equal('progress' in value, false);
  assert.equal(value.schedules.length, 1);
});

test('schedule CRUD is owner scoped and missing update/delete return 404', async () => {
  const calls = [];
  const scheduler = {
    list(owner) { calls.push(['list', owner]); return [{ id: 's1', owner }]; },
    create(owner, body) { calls.push(['create', owner, body]); return { id: 's2', ...body }; },
    update(owner, id, body) { calls.push(['update', owner, id, body]); return id === 'missing' ? null : { id, ...body }; },
    remove(owner, id) { calls.push(['remove', owner, id]); return id !== 'missing'; }
  };
  const queue = { status: () => ({ state: 'idle', items: [], events: [], updatedAt: '' }) };
  const { router, routes } = registry();
  registerNovelFetchV2Routes(router, { queue, scheduler });

  const listed = await call(routes.get('GET /schedules'), { username: 'bob' });
  assert.equal(listed.body.schedules[0].owner, 'bob');
  const created = await call(routes.get('POST /schedules'), { username: 'bob', body: { runAt: '2030-01-01T00:00:00.000Z', inputSnapshot: {} } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.id, 's2');
  const missingPatch = await call(routes.get('PATCH /schedules/:id'), { username: 'bob', params: { id: 'missing' } });
  assert.equal(missingPatch.statusCode, 404);
  const missingDelete = await call(routes.get('DELETE /schedules/:id'), { username: 'bob', params: { id: 'missing' } });
  assert.equal(missingDelete.statusCode, 404);
  assert.ok(calls.every(entry => entry[1] === 'bob'));
});
