const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { createNovelFetchUploadRouter } = require('./novel-fetch-upload');

async function withRouter(options, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/novel-fetch-upload', createNovelFetchUploadRouter({
    auth: (req, res, next) => { req.username = 'owner'; req.auth = { account: {} }; next(); },
    ...options
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test('legacy upload login uses the direct 121 login and stores its cookie session', async () => {
  let saved = null;
  const calls = [];
  await withRouter({
    store: { setSession: (_, cookie, metadata) => { saved = { cookie, metadata }; } },
    directClient: { login: async payload => { calls.push(payload); return { cookie: 'PHPSESSID=direct' }; } }
  }, async port => {
    const result = await request(port, 'POST', '/api/novel-fetch-upload/upload-login', { username: 'alice', password: 'secret' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });
  assert.deepEqual(calls, [{ username: 'alice', password: 'secret' }]);
  assert.deepEqual(saved, { cookie: 'PHPSESSID=direct', metadata: { targetUsername: 'alice', baseUrl: 'http://two.121w.com/tttadmin' } });
});

test('legacy upload session returns expired when direct verification fails', async () => {
  await withRouter({
    store: { getSession: () => ({ cookie: 'PHPSESSID=expired' }) },
    directClient: { verify: async () => { const error = new Error('expired'); error.code = 'SESSION_EXPIRED'; error.status = 401; throw error; } }
  }, async port => {
    const result = await request(port, 'GET', '/api/novel-fetch-upload/upload-session');
    assert.equal(result.status, 401);
    assert.equal(result.body.notLoggedIn, true);
  });
});
