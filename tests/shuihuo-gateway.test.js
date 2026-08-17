process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456', choushiyiguai1: '123456', choushiyiguai2: '123456', choushiyiguai3: '123456', choushiyiguai4: '123456', choushiyiguai5: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => server.close(closeError => error || closeError ? reject(error || closeError) : resolve(response));
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: requestPath, method, headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('error', finish);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function startBackendStub(t, secret) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const issuedAt = req.headers['x-qiantie-issued-at'];
      const payload = ['choushiyiguai1', issuedAt, 'false', 'POST', '/api/shuihuo-production/projects'].join('\n');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(req.headers['x-qiantie-signature'], expected);
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers['x-qiantie-username'], 'choushiyiguai1');
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), { name: '雨夜车站', sourceText: '第一段' });
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 12, name: '雨夜车站' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function startHealthFailureStub(t, secret) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const issuedAt = req.headers['x-qiantie-issued-at'];
      const payload = ['choushiyiguai1', issuedAt, 'false', 'GET', '/api/shuihuo-production/health'].join('\n');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(req.headers['x-qiantie-signature'], expected);
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers['x-qiantie-username'], 'choushiyiguai1');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ready: false, redisConfigured: false, reasons: ['redis_unavailable'] }));
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

test('water production gateway authenticates the platform token and signs the Go request', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-gateway-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const secret = 'test-bridge-secret';
  const targetBaseUrl = await startBackendStub(t, secret);
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    shuihuoGateway: { targetBaseUrl, bridgeSecret: secret }
  });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  assert.equal(login.status, 200);
  const result = await request(app, { method: 'POST', requestPath: '/api/shuihuo-production/projects', token: JSON.parse(login.body).token, body: { name: '雨夜车站', sourceText: '第一段' } });
  assert.equal(result.status, 201);
  assert.deepEqual(JSON.parse(result.body), { id: 12, name: '雨夜车站' });
});

test('water production gateway rejects a request without a platform session', async () => {
  const app = createApp({ shuihuoGateway: { targetBaseUrl: 'http://127.0.0.1:1', bridgeSecret: 'test-bridge-secret' } });
  const result = await request(app, { requestPath: '/api/shuihuo-production/projects' });
  assert.equal(result.status, 401);
});

test('gateway surfaces Go readiness failure without hiding it', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-health-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const secret = 'test-bridge-secret';
  const targetBaseUrl = await startHealthFailureStub(t, secret);
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    shuihuoGateway: { targetBaseUrl, bridgeSecret: secret }
  });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  const result = await request(app, { requestPath: '/api/shuihuo-production/health', token: JSON.parse(login.body).token });
  assert.equal(result.status, 503);
  assert.deepEqual(JSON.parse(result.body), { ready: false, redisConfigured: false, reasons: ['redis_unavailable'] });
});
