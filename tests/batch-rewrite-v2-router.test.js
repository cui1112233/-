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

test('V2 router applies supplied auth middleware and registers queue/scheduler endpoints', () => {
  const auth = () => {};
  const queue = { start() {}, pause() {}, resume() {}, stop() {}, status() { return { state: 'idle', items: [] }; } };
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { processConflicts() { return []; }, list() { return []; }, permanentDelete() {}, restoreTombstone() {}, setAiCount() {} };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, auth, routerFactory: fakeRouter });
  assert.deepEqual(router.uses, [auth]);
  const paths = new Set(router.routes.map(item => `${item.method.toUpperCase()} ${item.path}`));
  for (const expected of [
    'POST /process/queue/start', 'POST /process/queue/pause', 'POST /process/queue/resume', 'POST /process/queue/stop',
    'GET /process/queue/status', 'GET /realtime/status', 'GET /schedules', 'POST /schedules', 'PATCH /schedules/:id', 'DELETE /schedules/:id',
    'POST /process/start', 'GET /tasks', 'POST /tasks/batch-delete-permanent', 'POST /tasks/:id/restore-tombstone', 'POST /tasks/batch-ai-count'
  ]) assert.ok(paths.has(expected), expected);
});
