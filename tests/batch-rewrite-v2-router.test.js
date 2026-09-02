const test = require('node:test');
const assert = require('node:assert/strict');

const { createBatchRewriteV2Router } = require('../routes/batch-rewrite-v2');

function fakeRouter() {
  const uses = [];
  const routes = [];
  const router = { uses, routes };
  router.use = fn => { uses.push(fn); return router; };
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, handler) => { routes.push({ method, path, handler }); return router; };
  }
  return router;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; }
  };
}

function queueFixture() {
  const state = { state: 'idle', items: [] };
  return {
    state,
    start(owner, payloads) {
      const payload = payloads[0] || {};
      state.state = 'running';
      state.items.push({ id: `job-${state.items.length + 1}`, owner, state: 'queued', payload, attempts: 0, createdAt: '2026-09-01T07:00:00.000Z' });
      return structuredClone(state);
    },
    pause() { return structuredClone(state); },
    resume() { return structuredClone(state); },
    stop() { return structuredClone(state); },
    status() { return structuredClone(state); }
  };
}

test('V2 router applies supplied auth middleware and registers queue/scheduler endpoints', () => {
  const auth = () => {};
  const queue = queueFixture();
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { processConflicts() { return []; }, list() { return []; }, permanentDelete() {}, restoreTombstone() {}, setSelectedVersions() {}, reprocessSensitive() {} };
  const webSubmit = { getConfig() {}, saveConfig() {}, environment() {}, syncConfigs() {}, syncStyles() {}, testVisible() {}, preview() {}, submit() {} };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, webSubmit, auth, routerFactory: fakeRouter });
  assert.deepEqual(router.uses, [auth]);
  const paths = new Set(router.routes.map(item => `${item.method.toUpperCase()} ${item.path}`));
  for (const expected of [
    'POST /process/queue/start', 'POST /process/queue/pause', 'POST /process/queue/resume', 'POST /process/queue/stop',
    'GET /process/queue/status', 'GET /realtime/status', 'GET /schedules', 'POST /schedules', 'PATCH /schedules/:id', 'DELETE /schedules/:id',
    'POST /process/start', 'GET /process/jobs/latest', 'GET /process/jobs/:id',
    'GET /tasks', 'POST /tasks/batch-delete-permanent', 'POST /tasks/:id/restore-tombstone', 'POST /tasks/batch-versions', 'POST /tasks/reprocess-sensitive',
    'GET /web-submit/config', 'POST /web-submit/config', 'GET /web-submit/environment', 'POST /web-submit/sync-configs',
    'POST /web-submit/sync-styles', 'POST /web-submit/test-visible', 'POST /web-submit/preview', 'POST /web-submit/submit'
  ]) assert.ok(paths.has(expected), expected);
});

test('legacy process/start is terminated by V2 queue bridge and never next() into old Node processPayload', async () => {
  const queue = queueFixture();
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { processConflicts() { return []; }, list() { return []; }, permanentDelete() {}, restoreTombstone() {}, setSelectedVersions() {} };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, auth: () => {}, routerFactory: fakeRouter });
  const route = router.routes.find(item => item.method === 'post' && item.path === '/process/start');
  const res = response();
  let nextCalls = 0;
  await route.handler({ username: 'alice', body: { input_text: '10001\t示例' } }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(res.body.id, 'job-1');
  assert.equal(res.body.status, 'running');
  assert.equal(queue.state.items[0].payload.input_text, '10001\t示例');
});

test('V2 process job polling maps persisted queue items into the legacy UI job contract', async () => {
  const queue = queueFixture();
  queue.start('alice', [{ input_text: '10001\t示例' }]);
  queue.state.items[0] = {
    ...queue.state.items[0],
    state: 'done',
    attempts: 1,
    startedAt: '2026-09-01T07:00:01.000Z',
    completedAt: '2026-09-01T07:00:02.000Z',
    result: { fetched: 1 }
  };
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const router = createBatchRewriteV2Router({ queue, scheduler, auth: () => {}, routerFactory: fakeRouter });

  const latestRoute = router.routes.find(item => item.method === 'get' && item.path === '/process/jobs/latest');
  const latestRes = response();
  await latestRoute.handler({ username: 'alice', query: { limit: '1' } }, latestRes);
  assert.equal(latestRes.body.latest.id, 'job-1');
  assert.equal(latestRes.body.latest.status, 'done');
  assert.deepEqual(latestRes.body.latest.result, { fetched: 1 });

  const jobRoute = router.routes.find(item => item.method === 'get' && item.path === '/process/jobs/:id');
  const jobRes = response();
  await jobRoute.handler({ username: 'alice', params: { id: 'job-1' } }, jobRes);
  assert.equal(jobRes.body.status, 'done');
  assert.deepEqual(jobRes.body.result, { fetched: 1 });
});

test('V2 sensitive reprocess errors are answered directly and never fall through to legacy sensitive handler', async () => {
  const queue = queueFixture();
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { processConflicts() { return []; }, async reprocessSensitive() { throw new Error('v2-sensitive-failed'); } };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, auth: () => {}, routerFactory: fakeRouter });
  const route = router.routes.find(item => item.method === 'post' && item.path === '/tasks/reprocess-sensitive');
  const res = response();
  let nextCalls = 0;
  await route.handler({ username: 'alice', body: { mode: 'selected', ids: ['a'] } }, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'v2-sensitive-failed');
  assert.equal(nextCalls, 0);
});

test('Browser Worker errors are answered by V2 and never next() into legacy Node web-submit handlers', async () => {
  const queue = queueFixture();
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const error = Object.assign(new Error('浏览器登录服务不可用'), { code: 'BROWSER_WORKER_UNAVAILABLE' });
  const webSubmit = { async saveConfig() { throw error; } };
  const router = createBatchRewriteV2Router({ queue, scheduler, webSubmit, auth: () => {}, routerFactory: fakeRouter });
  const route = router.routes.find(item => item.method === 'post' && item.path === '/web-submit/config');
  const res = response();
  let nextCalls = 0;
  await route.handler({ username: 'alice', body: { settings: { username: 'site-user', password: 'pw' } } }, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'BROWSER_WORKER_UNAVAILABLE');
  assert.equal(nextCalls, 0);
});
