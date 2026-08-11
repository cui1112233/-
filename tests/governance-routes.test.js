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

test('accepts a safe account application but rejects weak and duplicate requests', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);

  const created = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_01', password: 'secret-123', reason: '小说创作' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'pending');
  assert.match(created.body.id, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(JSON.stringify(created.body), /secret-123|passwordHash/);

  const status = await request(app, {
    method: 'POST',
    requestPath: `/api/applications/${created.body.id}/status`,
    body: { username: 'writer_01', password: 'secret-123' }
  });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.status, 'pending');
  assert.doesNotMatch(JSON.stringify(status.body), /secret-123|passwordHash|audit/i);

  const unauthorizedStatus = await request(app, {
    method: 'POST',
    requestPath: `/api/applications/${created.body.id}/status`,
    body: { username: 'writer_01', password: 'wrong-password' }
  });
  assert.equal(unauthorizedStatus.status, 404);

  const weak = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_02', password: 'short', reason: '小说创作' }
  });
  assert.equal(weak.status, 400);

  const duplicate = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_01', password: 'another-secret', reason: '再次申请' }
  });
  assert.equal(duplicate.status, 400);

  const withdrawn = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_03', password: 'secret-789', reason: '小说创作' }
  });
  const withdrawal = await request(app, {
    method: 'POST',
    requestPath: `/api/applications/${withdrawn.body.id}/withdraw`,
    body: { username: 'writer_03', password: 'secret-789' }
  });
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.status, 'withdrawn');
  const withdrawnStatus = await request(app, {
    method: 'POST',
    requestPath: `/api/applications/${withdrawn.body.id}/status`,
    body: { username: 'writer_03', password: 'secret-789' }
  });
  assert.equal(withdrawnStatus.body.status, 'withdrawn');
});

test('approved applicants can log in while pending applicants cannot', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);
  const owner = await login(app, 'choushiyiguai');
  const submitted = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_01', password: 'secret-123', reason: '小说创作' }
  });

  assert.equal((await login(app, 'writer_01', 'secret-123')).status, 401);
  const approval = await request(app, {
    method: 'POST',
    requestPath: `/api/admin/applications/${submitted.body.id}/approve`,
    token: owner.body.token
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.application.status, 'approved');
  assert.equal(approval.body.account.active, true);
  assert.equal((await login(app, 'writer_01', 'secret-123')).status, 200);
});

test('account reviewers manage accounts but cannot manage grants or audit', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);
  const owner = await login(app, 'choushiyiguai');
  runtime.accountStore.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'account:review',
    scope: '*'
  });
  const reviewer = await login(app, 'choushiyiguai1');
  const submitted = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_01', password: 'secret-123', reason: '小说创作' }
  });

  assert.equal((await request(app, {
    requestPath: '/api/admin/accounts', token: reviewer.body.token
  })).status, 200);
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: `/api/admin/applications/${submitted.body.id}/approve`,
    token: reviewer.body.token
  })).status, 200);
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: '/api/admin/grants',
    token: reviewer.body.token,
    body: { subject: 'writer_01', capability: 'preset:draft', scope: 'novel-panel' }
  })).status, 403);
  assert.equal((await request(app, {
    requestPath: '/api/admin/audit', token: reviewer.body.token
  })).status, 403);

  const grant = await request(app, {
    method: 'POST',
    requestPath: '/api/admin/grants',
    token: owner.body.token,
    body: { subject: 'writer_01', capability: 'preset:draft', scope: 'novel-panel' }
  });
  assert.equal(grant.status, 201);
  const revoked = await request(app, {
    method: 'DELETE',
    requestPath: `/api/admin/grants/${grant.body.grant.id}`,
    token: owner.body.token
  });
  assert.equal(revoked.status, 200);
  const audit = await request(app, { requestPath: '/api/admin/audit', token: owner.body.token });
  assert.equal(audit.status, 200);
  assert.match(JSON.stringify(audit.body), /application\.submitted|application\.approved|grant\.created|grant\.revoked/);
  assert.doesNotMatch(JSON.stringify(audit.body), /secret-123|passwordHash/);
});

test('reviewers can reject, disable, and reset passwords without crossing other permissions', async t => {
  const runtime = createTestRuntime(t);
  const app = createApp(runtime);
  const owner = await login(app, 'choushiyiguai');
  runtime.accountStore.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'account:review',
    scope: '*'
  });
  const reviewer = await login(app, 'choushiyiguai1');
  const rejected = await request(app, {
    method: 'POST',
    requestPath: '/api/applications',
    body: { username: 'writer_02', password: 'secret-456', reason: '小说创作' }
  });
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: `/api/admin/applications/${rejected.body.id}/reject`,
    token: reviewer.body.token
  })).status, 200);
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: '/api/admin/accounts/choushiyiguai2/status',
    token: reviewer.body.token,
    body: { active: false }
  })).status, 200);
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: '/api/admin/accounts/choushiyiguai2/reset-password',
    token: reviewer.body.token,
    body: { password: 'new-secret-789' }
  })).status, 200);
  assert.equal((await login(app, 'choushiyiguai2', 'new-secret-789')).status, 401);
  assert.equal((await request(app, {
    method: 'POST',
    requestPath: '/api/admin/accounts/choushiyiguai2/status',
    token: owner.body.token,
    body: { active: true }
  })).status, 200);
  assert.equal((await login(app, 'choushiyiguai2', 'new-secret-789')).status, 200);
});
