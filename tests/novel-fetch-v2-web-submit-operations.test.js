const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebSubmitOperationStore } = require('../lib/novel-fetch-workshop/web-submit-operations');
const { registerWebSubmitRoutes } = require('../routes/batch-rewrite-v2');

function fakeRouter() {
  const routes = [];
  const router = { routes, use() { return router; } };
  for (const method of ['get', 'post']) {
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
    json(value) { this.body = value; this.headersSent = true; return this; },
  };
}

test('后台操作异步执行、可轮询，并且快照不暴露账号密码', async () => {
  const store = createWebSubmitOperationStore();
  const operation = store.create('alice', 'login', async report => {
    report('running', '正在登录批量后台');
    await new Promise(resolve => setTimeout(resolve, 0));
    return { settings: { username: 'site-user', password_masked: true } };
  });

  assert.equal(operation.status, 'running');
  assert.equal('owner' in operation, false);
  assert.equal('password' in operation, false);

  await new Promise(resolve => setTimeout(resolve, 10));
  const completed = store.get('alice', operation.id);
  assert.equal(completed.status, 'done');
  assert.match(completed.steps.map(step => step.message).join('\n'), /正在登录批量后台/);
  assert.equal(JSON.stringify(completed).includes('"password":"pw"'), false);
  assert.equal(store.get('bob', operation.id), null);
});

test('V2 注册后台配置异步操作的创建和轮询接口', async () => {
  const router = fakeRouter();
  const operations = createWebSubmitOperationStore();
  const webSubmit = {
    async saveConfig(owner, settings) { return { settings: { username: settings.username, password_masked: true } }; },
    async syncConfigs() { return { settings: {}, profiles: [] }; },
    async syncStyles() { return { settings: {}, styles: [] }; },
  };
  registerWebSubmitRoutes(router, webSubmit, { operations });
  assert.ok(router.routes.some(route => route.method === 'post' && route.path === '/web-submit/operations'));
  assert.ok(router.routes.some(route => route.method === 'get' && route.path === '/web-submit/operations/:id'));

  const start = router.routes.find(route => route.method === 'post' && route.path === '/web-submit/operations');
  const res = response();
  await start.handler({ username: 'alice', body: { kind: 'login', username: 'site-user', password: 'pw' } }, res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.kind, 'login');
  assert.equal(JSON.stringify(res.body).includes('pw'), false);

  await new Promise(resolve => setTimeout(resolve, 10));
  const poll = router.routes.find(route => route.method === 'get' && route.path === '/web-submit/operations/:id');
  const pollRes = response();
  await poll.handler({ username: 'alice', params: { id: res.body.id } }, pollRes);
  assert.equal(pollRes.body.status, 'done');
});
