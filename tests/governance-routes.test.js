const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { apiAuth, requireCapability, requireOwner } = require('../middleware/auth');

function createTestRuntime(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-governance-'));
  const accountStore = createAccountStore({ systemDir });
  const tokenMap = new Map();
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return { accountStore, tokenMap };
}

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => {
      server.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve(response);
      });
    };

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: text ? JSON.parse(text) : null
          });
        });
      });
      req.once('error', error => finish(error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function login(app, username, password = '123456') {
  return request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password }
  });
}

test('createApp returns an Express request handler without listening', t => {
  const runtime = createTestRuntime(t);
  const originalListen = http.Server.prototype.listen;
  let listenCalls = 0;

  http.Server.prototype.listen = function listen() {
    listenCalls += 1;
    return this;
  };

  try {
    const app = createApp(runtime);

    assert.equal(typeof app, 'function');
    assert.equal(listenCalls, 0);
  } finally {
    http.Server.prototype.listen = originalListen;
  }
});

test('seeds legacy accounts and issues a 64-hex session token with safe metadata', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);

  const response = await login(app, 'choushiyiguai');

  assert.equal(response.status, 200);
  assert.match(response.body.token, /^[a-f0-9]{64}$/);
  assert.equal(response.body.username, 'choushiyiguai');
  assert.equal(response.body.active, true);
  assert.equal(response.body.isOwner, true);
  assert.deepEqual(response.body.effectivePermissions, [{ capability: '*', scope: '*' }]);
  assert.equal(Object.hasOwn(response.body, 'passwordHash'), false);
  assert.equal(Object.hasOwn(response.body, 'password'), false);
  assert.deepEqual(runtime.tokenMap.get(response.body.token).username, 'choushiyiguai');
  assert.equal(typeof runtime.tokenMap.get(response.body.token).issuedAt, 'number');
  assert.equal(runtime.accountStore.listAccounts().length, 6);
});

test('rejects login when the persisted password does not verify', async t => {
  const app = createApp(createTestRuntime(t));

  const response = await login(app, 'choushiyiguai', 'wrong-password');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: '用户名或密码错误' });
});

test('rejects a saved session immediately after its account is disabled', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);
  const authenticated = await login(app, 'choushiyiguai1');
  assert.equal(authenticated.status, 200);

  runtime.accountStore.setActive('choushiyiguai1', false);
  const response = await request(app, {
    requestPath: '/api/config',
    token: authenticated.body.token
  });

  assert.equal(response.status, 401);
});

test('enforces account review and scoped preset capabilities without a production admin route', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);
  const capabilityApp = express();
  capabilityApp.locals.authRuntime = app.locals.authRuntime;
  const testRouter = express.Router();
  testRouter.get('/review', apiAuth, requireCapability('account:review'), (req, res) => res.json({ ok: true }));
  testRouter.get('/draft/:module', apiAuth, requireCapability('preset:draft', req => req.params.module), (req, res) => res.json({ ok: true }));
  testRouter.get('/owner', apiAuth, requireOwner, (req, res) => res.json({ ok: true }));
  capabilityApp.use('/__test_capabilities', testRouter);

  const ordinary = await login(app, 'choushiyiguai1');
  const owner = await login(app, 'choushiyiguai');
  assert.equal((await request(capabilityApp, {
    requestPath: '/__test_capabilities/review', token: ordinary.body.token
  })).status, 403);
  assert.equal((await request(capabilityApp, {
    requestPath: '/__test_capabilities/review', token: owner.body.token
  })).status, 200);
  assert.equal((await request(capabilityApp, {
    requestPath: '/__test_capabilities/owner', token: owner.body.token
  })).status, 200);
  assert.equal((await request(capabilityApp, {
    requestPath: '/__test_capabilities/owner', token: ordinary.body.token
  })).status, 403);

  runtime.accountStore.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  });
  assert.equal((await request(capabilityApp, {
    requestPath: '/__test_capabilities/draft/novel-panel', token: ordinary.body.token
  })).status, 200);
  const denied = await request(capabilityApp, {
    requestPath: '/__test_capabilities/draft/other-panel', token: ordinary.body.token
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: 'Forbidden' });
});
