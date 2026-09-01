const test = require('node:test');
const assert = require('node:assert/strict');

const { createBatchRewriteV2Router } = require('../routes/batch-rewrite-v2');

function fakeRouter() {
  const routes = [];
  const router = { routes, use() { return router; } };
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, handler) => { routes.push({ method, path, handler }); return router; };
  }
  return router;
}

test('V2 router forwards batch store and selected-stop capability to route contract', () => {
  const queue = { start() {}, pause() {}, resume() {}, stop() {}, status() { return { state: 'idle', items: [] }; } };
  const scheduler = { list() { return []; }, create() {}, update() {}, remove() {} };
  const taskOps = { list() { return []; }, cancelSelected() {}, permanentDelete() {}, restoreTombstone() {}, setAiCount() {} };
  const batches = { current() { return null; }, list() { return []; }, prepareRerun() { return null; } };
  const router = createBatchRewriteV2Router({ queue, scheduler, taskOps, batches, auth: () => {}, routerFactory: fakeRouter });
  const paths = new Set(router.routes.map(item => `${item.method.toUpperCase()} ${item.path}`));

  for (const expected of ['GET /batches/current', 'GET /batches', 'POST /batches/:id/rerun', 'POST /tasks/stop-selected']) {
    assert.ok(paths.has(expected), expected);
  }
});
