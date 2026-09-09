const test = require('node:test');
const assert = require('node:assert/strict');
const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');
const target = require('../lib/target-upload');

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

function assertNoSensitiveResponseFields(value) {
  const forbidden = /(password|cookie|session|secret|token|authorization)/i;
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.test(key), false, `response exposed sensitive field: ${key}`);
      visit(child);
    }
  };
  visit(value);
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
  assertNoSensitiveResponseFields(res.body);
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
  assertNoSensitiveResponseFields(res.body);
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
  assertNoSensitiveResponseFields(res.body);
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
  assert.equal(res.statusCode, 401);
  assertNoSensitiveResponseFields(res.body);
});

test('upload-login keeps worker HTTP failures as non-success responses with safe error structure', async t => {
  for (const [label, failure, expectedStatus] of [
    ['not authorized', Object.assign(new Error('worker unauthorized'), { status: 401, code: 'BROWSER_WORKER_UNAUTHORIZED' }), 503],
    ['not found', Object.assign(new Error('worker route missing'), { status: 404 }), 404],
    ['bad gateway', Object.assign(new Error('upstream bad gateway'), { status: 502 }), 502],
    ['timeout', Object.assign(new Error('worker timeout'), { code: 'BROWSER_WORKER_TIMEOUT' }), 503]
  ]) {
    await t.test(label, async () => {
      const f = fixture();
      f.browserClient.login = async () => { throw failure; };
      const handler = routeHandler(f.router, 'post', '/upload-login');
      const res = response();
      await handler({ username: 'alice', body: { username: 'site-user', password: 'secret-pw' } }, res);
      assert.equal(res.statusCode, expectedStatus);
      assert.equal(res.body.ok, false);
      assertNoSensitiveResponseFields(res.body);
    });
  }
});

test('upload-login maps the Browser Worker raw unauthorized response to infrastructure 503', async () => {
  const f = fixture();
  const failure = Object.assign(new Error('浏览器登录服务失败：unauthorized'), {
    status: 401,
    code: 'unauthorized',
    workerResponse: { error: 'unauthorized' }
  });
  f.browserClient.login = async () => { throw failure; };
  const handler = routeHandler(f.router, 'post', '/upload-login');
  const res = response();
  await handler({ username: 'alice', body: { username: 'site-user', password: 'secret-pw' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'BROWSER_WORKER_UNAUTHORIZED');
  assertNoSensitiveResponseFields(res.body);
});

test('upload-batch does not turn worker HTTP failures into an ok batch response', async () => {
  for (const failure of [
    Object.assign(new Error('not found'), { status: 404 }),
    Object.assign(new Error('bad gateway'), { status: 502 }),
    Object.assign(new Error('timeout'), { code: 'BROWSER_WORKER_TIMEOUT' })
  ]) {
    const f = fixture();
    f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
    f.browserClient.action = async () => { throw failure; };
    const handler = routeHandler(f.router, 'post', '/upload-batch');
    const res = response();
    await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] } }, res);
    assert.notEqual(res.statusCode, 200);
    assert.equal(res.body.ok, false);
    assertNoSensitiveResponseFields(res.body);
  }
});

test('upload-batch maps the Browser Worker raw unauthorized response to infrastructure 503', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  f.browserClient.action = async () => {
    throw Object.assign(new Error('浏览器登录服务失败：unauthorized'), {
      status: 401,
      code: 'unauthorized',
      workerResponse: { error: 'unauthorized' }
    });
  };
  const handler = routeHandler(f.router, 'post', '/upload-batch');
  const res = response();
  await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'BROWSER_WORKER_UNAUTHORIZED');
  assertNoSensitiveResponseFields(res.body);
});

test('upload-batch keeps Browser Worker action_failed as a per-book error and continues the batch', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  let calls = 0;
  f.browserClient.action = async () => {
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new Error('target rejected upload'), {
        status: 400,
        code: 'action_failed',
        workerResponse: { ok: false, error: 'action_failed' }
      });
    }
    return { ok: true, body: JSON.stringify({ success: true }) };
  };
  const handler = routeHandler(f.router, 'post', '/upload-batch');
  const res = response();
  await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [
    { bookId: '10001', gender: '女', style: '现代甜文' },
    { bookId: '10001', gender: '女', style: '现代甜文' }
  ] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.results.map(item => item.status), ['error', 'ok']);
  assertNoSensitiveResponseFields(res.body);
});

test('upload-batch safely maps buildUploadFields exceptions without returning sensitive text', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  const originalBuildUploadFields = target.buildUploadFields;
  target.buildUploadFields = () => { throw new Error('password=secret-pw Token=private-token'); };
  try {
    const handler = routeHandler(f.router, 'post', '/upload-batch');
    const res = response();
    await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.results[0].status, 'error');
    assertNoSensitiveResponseFields(res.body);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-pw|private-token/);
  } finally {
    target.buildUploadFields = originalBuildUploadFields;
  }
});

test('upload-batch redacts sensitive text from per-item worker errors', async () => {
  const f = fixture();
  f.setSession({ mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  f.browserClient.action = async () => { throw new Error('password=secret-pw Cookie=private-cookie Token=private-token'); };
  const handler = routeHandler(f.router, 'post', '/upload-batch');
  const res = response();
  await handler({ username: 'alice', auth: { account: { username: 'alice' } }, body: { platformId: 2, advanced: {}, items: [{ bookId: '10001', gender: '女', style: '现代甜文' }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.results[0].status, 'error');
  assertNoSensitiveResponseFields(res.body);
  assert.doesNotMatch(JSON.stringify(res.body), /secret-pw|private-cookie|private-token/);
});
