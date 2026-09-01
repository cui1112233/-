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

test('V2 router applies supplied auth middleware and registers queue/scheduler endpoints', () => {
  const auth = () => {};
  const queue = { start() {}, pause() {}, resume() {}, stop() {}, status() { return { state: 'idle', items: [] }; } };
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { processConflicts() { return []; }, list() { return []; }, permanentDelete() {}, restoreTombstone() {}, setAiCount() {} };
  const webSubmit = { getConfig() {}, saveConfig() {}, environment() {}, syncConfigs() {}, syncStyles() {}, testVisible() {}, preview() {}, submit() {} };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, webSubmit, auth, routerFactory: fakeRouter });
  assert.deepEqual(router.uses, [auth]);
  const paths = new Set(router.routes.map(item => `${item.method.toUpperCase()} ${item.path}`));
  for (const expected of [
    'POST /process/queue/start', 'POST /process/queue/pause', 'POST /process/queue/resume', 'POST /process/queue/stop',
    'GET /process/queue/status', 'GET /realtime/status', 'GET /schedules', 'POST /schedules', 'PATCH /schedules/:id', 'DELETE /schedules/:id',
    'POST /process/start', 'GET /tasks', 'POST /tasks/batch-delete-permanent', 'POST /tasks/:id/restore-tombstone', 'POST /tasks/batch-ai-count',
    'GET /web-submit/config', 'POST /web-submit/config', 'GET /web-submit/environment', 'POST /web-submit/sync-configs',
    'POST /web-submit/sync-styles', 'POST /web-submit/test-visible', 'POST /web-submit/preview', 'POST /web-submit/submit'
  ]) assert.ok(paths.has(expected), expected);
});

test('Browser Worker errors are answered by V2 and never next() into legacy Node web-submit handlers', async () => {
  const queue = { start() {}, pause() {}, resume() {}, stop() {}, status() { return { state: 'idle', items: [] }; } };
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
