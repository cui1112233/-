const test = require('node:test');
const assert = require('node:assert/strict');
const { registerNovelFetchV2Routes } = require('./v2-api-contract');

function fakeRouter() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    patch() {}, delete() {}
  };
}

test('队列状态返回全局资源池占用', () => {
  const router = fakeRouter();
  registerNovelFetchV2Routes(router, {
    queue: { status: () => ({ state: 'idle', items: [] }) },
    scheduler: { list: () => [] },
    throughput: { snapshot: () => ({ active: { fetch: 2 }, limits: { fetch: 2 }, paused: true }) }
  });
  let body;
  router.routes.get('GET /process/queue/status')({ username: 'alice' }, { json: value => { body = value; } });
  assert.deepEqual(body.throughput, { active: { fetch: 2 }, limits: { fetch: 2 }, paused: true });
});
