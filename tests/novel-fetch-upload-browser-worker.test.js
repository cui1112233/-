const test = require('node:test');
const assert = require('node:assert/strict');
const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');

function routeHandler(router, method, path) {
  const layer = router.stack.find(item => item.route?.path === path && item.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} missing`);
  return layer.route.stack[0].handle;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function fixture() {
  const calls = [];
  let browserSession = null;
  const store = {
    setBrowserSession(owner, value) { calls.push(['setBrowserSession', owner, value]); browserSession = { ...value, loginAt: '2026-09-01T07:00:00.000Z' }; return browserSession; },
    getBrowserSession() { return browserSession; },
    read(_owner, bookId) {
      return bookId === '10001' ? { text: '正文内容'.repeat(30), meta: { gender: '女', style: '现代甜文' } } : null;
    }
  };
  const browserClient = {
    configured: true,
    async login(input) { calls.push(['login', input]); return { ok: true, status: 'ready', sessionKey: 'opaque-session' }; },
    async test(input) { calls.push(['test', input]); return { ok: true, status: 'ready', sessionKey: 'opaque-session' }; },
    async action(input) {
      calls.push(['action', input]);
      return { ok: true, body: JSON.stringify({ success: true, result: { success: { count: 1, files: ['10001.txt'] }, failed: { count: 0, files: [] } } }) };
    }
  };
  const router = createNovelFetchUploadRouter({ auth: (_req, _res, next) => next(), store, browserClient });
  return { router, store, browserClient, calls, setSession(value) { browserSession = value; } };
}

test('upload-login authenticates through Browser Worker and persists only an opaque browser session reference', async () => {
  const f = fixture();
  const handler = routeHandler(f.router, 'post', '/upload-login');
  const res = response();
  await handler({ username: 'alice', body: { username: 'site-user', password: 'secret-pw' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, username: 'site-user', status: 'ready' });
  const login = f.calls.find(([kind]) => kind === 'login')[1];
  assert.equal(login.owner, 'alice');
  assert.equal(login.username, 'site-user');
  assert.equal(login.password, 'secret-pw');
  const saved = f.calls.find(([kind]) => kind === 'setBrowserSession')[2];
  assert.equal(saved.sessionKey, 'opaque-session');
  assert.equal(Object.hasOwn(saved, 'cookie'), false);
  assert.equal(Object.hasOwn(saved, 'password'), false);
});

test('upload-session verifies the browser-owned storage_state session instead of trusting a Node cookie', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready', loginAt: '2026-09-01T07:00:00.000Z' });
  const handler = routeHandler(f.router, 'get', '/upload-session');
  const res = response();
  await handler({ username: 'alice' }, res);
  assert.equal(res.body.loggedIn, true);
  assert.equal(res.body.status, 'ready');
  assert.equal(f.calls.some(([kind]) => kind === 'test'), true);
});

test('upload-batch sends exact multipart bytes through Browser Worker authenticated action and never requires cookie material', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  const handler = routeHandler(f.router, 'post', '/upload-batch');
  const res = response();
  await handler({
    username: 'alice',
    auth: { account: { username: 'alice' } },
    body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.results[0].status, 'ok');
  const action = f.calls.find(([kind]) => kind === 'action')[1];
  assert.equal(action.action, 'upload');
  assert.equal(action.owner, 'alice');
  assert.match(action.payload.contentType, /^multipart\/form-data; boundary=/);
  assert.ok(action.payload.bodyBase64.length > 20);
  const body = Buffer.from(action.payload.bodyBase64, 'base64').toString('utf8');
  assert.match(body, /filename="10001\.txt"/);
  assert.doesNotMatch(JSON.stringify(action), /PHPSESSID|Cookie/);
});

test('expired Browser Worker session is surfaced as notLoggedIn and does not fall back to legacy Node login or upload', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  f.browserClient.action = async () => { const error = new Error('expired'); error.status = 401; error.code = 'session_expired'; throw error; };
  const handler = routeHandler(f.router, 'post', '/upload-batch');
  const res = response();
  await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] } }, res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.notLoggedIn, true);
});
