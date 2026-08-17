const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const {
  createPersistentSession,
  getPersistentSession,
  revokePersistentSession
} = require('../lib/session-store');

function createRuntime(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-persistent-session-'));
  const accountStore = createAccountStore({ systemDir });
  const sessionsPath = path.join(systemDir, 'sessions.json');
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return { accountStore, sessionsPath, tokenMap: new Map() };
}

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => server.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else resolve(response);
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          finish(null, { status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      });
      req.once('error', error => finish(error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function login(app, remember) {
  return request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username: 'choushiyiguai1', password: '123456', remember }
  });
}

test('persistent sessions store only a token digest and expire safely', t => {
  const { sessionsPath } = createRuntime(t);
  const token = 'persistent-token-which-must-not-be-written';

  createPersistentSession(sessionsPath, token, 'choushiyiguai1', 1000, 100);

  assert.deepEqual(getPersistentSession(sessionsPath, token, 999), { username: 'choushiyiguai1' });
  assert.equal(getPersistentSession(sessionsPath, token, 1100), null);
  assert.equal(fs.readFileSync(sessionsPath, 'utf8').includes(token), false);
  assert.equal(fs.statSync(sessionsPath).mode & 0o777, 0o600);
});

test('remembered login survives a new application runtime while a normal login does not', async t => {
  const runtime = createRuntime(t);
  const remembered = await login(createApp(runtime), true);
  const temporary = await login(createApp(runtime), false);
  assert.equal(remembered.status, 200);
  assert.equal(temporary.status, 200);

  const restarted = createApp({ ...runtime, tokenMap: new Map() });
  assert.equal((await request(restarted, { requestPath: '/api/config', token: remembered.body.token })).status, 200);
  assert.equal((await request(restarted, { requestPath: '/api/config', token: temporary.body.token })).status, 401);
});

test('logout and account disable revoke remembered tokens permanently', async t => {
  const runtime = createRuntime(t);
  const app = createApp(runtime);
  const remembered = await login(app, true);
  assert.equal(remembered.status, 200);

  assert.equal((await request(app, { method: 'POST', requestPath: '/api/login/logout', token: remembered.body.token })).status, 204);
  assert.equal((await request(createApp({ ...runtime, tokenMap: new Map() }), { requestPath: '/api/config', token: remembered.body.token })).status, 401);
  assert.equal(revokePersistentSession(runtime.sessionsPath, remembered.body.token), false);

  const nextRemembered = await login(app, true);
  runtime.accountStore.setActive('choushiyiguai1', false);
  assert.equal((await request(app, { requestPath: '/api/config', token: nextRemembered.body.token })).status, 401);
  runtime.accountStore.setActive('choushiyiguai1', true);
  assert.equal((await request(createApp({ ...runtime, tokenMap: new Map() }), { requestPath: '/api/config', token: nextRemembered.body.token })).status, 401);
});
