const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body || {});
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function makeStore(overrides = {}) {
  const session = overrides.session !== undefined ? overrides.session : { cookie: 'PHPSESSID=sess123' };
  const store = {
    getSession: () => session,
    setSession: () => {},
    read: overrides.read || (() => ({ text: '优化后正文', meta: { gender: '女', style: '现代虐文' } })),
    ...overrides.store
  };
  return store;
}

function makeApp({ store, httpClient, auth } = {}) {
  return express()
    .use(express.json())
    .use('/api/novel-fetch-upload', createNovelFetchUploadRouter({
      store: store || makeStore(),
      httpClient: httpClient || (async ({ method, url, headers, body }) => ({ status: 200, headers: { 'set-cookie': ['PHPSESSID=sess123; path=/'] }, body: JSON.stringify({ success: true }) })),
      auth: auth || ((req, res, next) => { req.username = 'tester'; next(); })
    }));
}

test('upload-login success stores cookie', async () => {
  const calls = [];
  const store = makeStore();
  store.setSession = (u, cookie) => { calls.push({ u, cookie }); };
  const app = makeApp({ store, httpClient: async ({ url }) => {
    if (url.includes('login.php')) return { status: 200, headers: { 'set-cookie': ['PHPSESSID=abc; path=/'] }, body: JSON.stringify({ success: true }) };
    return { status: 200, headers: {}, body: '自定义文案 管理后台' };
  } });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-login', body: { username: 'u', password: 'p' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(calls[0].cookie, 'PHPSESSID=abc');
});

test('upload-login rejects bad credentials without 401', async () => {
  const app = makeApp({ httpClient: async () => ({ status: 200, headers: {}, body: '管理员登录' }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-login', body: { username: 'u', password: 'wrong' } });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
});

test('upload-batch without session returns notLoggedIn (not 401)', async () => {
  const app = makeApp({ store: makeStore({ session: null }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.notLoggedIn, true);
});

test('upload-batch uploads each book sequentially and uses per-book gender/style', async () => {
  const requests = [];
  const app = makeApp({ httpClient: async (opts) => {
    requests.push({ url: opts.url, cookie: opts.headers.Cookie, body: opts.body.toString('utf8') });
    return { status: 200, headers: {}, body: JSON.stringify({ success: true }) };
  } });
  const result = await request(app, {
    requestPath: '/api/novel-fetch-upload/upload-batch',
    body: { platformId: 3, items: [
      { bookId: '1', gender: '女', style: '现代虐文' },
      { bookId: '2', gender: '男', style: '男频都市' }
    ] }
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.results.every(r => r.status === 'ok'));
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.includes('name="gender"') && requests[0].body.includes('2'));
  assert.ok(requests[1].body.includes('name="style"') && requests[1].body.includes('305'));
  assert.ok(requests[0].body.includes('优化后正文'));
});

test('upload-batch uses edited version from store', async () => {
  const requests = [];
  const store = makeStore({ read: () => ({ text: '这是用户编辑后的正文', meta: { gender: '女', style: '现代虐文' } }) });
  const app = makeApp({ store, httpClient: async (opts) => { requests.push(opts.body.toString('utf8')); return { status: 200, headers: {}, body: JSON.stringify({ success: true }) }; } });
  await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.ok(requests[0].includes('这是用户编辑后的正文'));
});

test('upload-batch one missing book fails that one, others continue', async () => {
  const store = makeStore({ read: (u, id) => (id === '2' ? null : { text: '正文', meta: { gender: '女', style: '现代虐文' } }) });
  const app = makeApp({ store });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [
    { bookId: '1', gender: '女', style: '现代虐文' },
    { bookId: '2', gender: '女', style: '现代虐文' }
  ] } });
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[1].status, 'error');
  assert.match(result.body.results[1].error, /未找到已保存的正文/);
});

test('upload-batch returns notLoggedIn when target returns login page', async () => {
  const app = makeApp({ httpClient: async () => ({ status: 200, headers: {}, body: '管理员登录' }) });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: { platformId: 3, items: [{ bookId: '1', gender: '女', style: '现代虐文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.notLoggedIn, true);
});

test('upload-session reports loggedIn', async () => {
  const app = makeApp({});
  const result = await request(app, { method: 'GET', requestPath: '/api/novel-fetch-upload/upload-session' });
  assert.equal(result.status, 200);
  assert.equal(result.body.loggedIn, true);
});
