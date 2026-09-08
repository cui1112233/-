'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { bridgePayload } = require('../lib/batch-factory-v11/go-proxy');

function installAuthStub() {
  const authPath = require.resolve('../middleware/auth');
  const original = require.cache[authPath];
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      apiAuth(req, res, next) {
        req.username = 'contract-user';
        req.auth = { account: { username: 'contract-user', isOwner: false } };
        next();
      }
    }
  };
  return () => {
    if (original) require.cache[authPath] = original;
    else delete require.cache[authPath];
  };
}

function loadRouterFactory() {
  const restoreAuth = installAuthStub();
  const routePath = require.resolve('../routes/shuihuo-production');
  delete require.cache[routePath];
  const route = require(routePath);
  restoreAuth();
  return route.createShuihuoProductionRouter;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test('local-executors readiness request is forwarded to Go with canonical bridge signature and response shape', async t => {
  const bridgeSecret = 'contract-fixture-only';
  let received = null;
  const goServer = http.createServer((req, res) => {
    received = {
      method: req.method,
      url: req.url,
      username: req.headers['x-qiantie-username'],
      isOwner: req.headers['x-qiantie-is-owner'],
      issuedAt: req.headers['x-qiantie-issued-at'],
      signature: req.headers['x-qiantie-signature']
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ executors: [{ id: 'executor-1', online: true }] }));
  });
  const goBase = await listen(goServer);
  t.after(() => close(goServer));

  const createShuihuoProductionRouter = loadRouterFactory();
  const app = express();
  app.use('/api/shuihuo-production', createShuihuoProductionRouter({ targetBaseUrl: goBase, bridgeSecret }));
  const appServer = http.createServer(app);
  const appBase = await listen(appServer);
  t.after(() => close(appServer));

  const response = await fetch(`${appBase}/api/shuihuo-production/local-executors?source=script`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { executors: [{ id: 'executor-1', online: true }] });

  assert.equal(received.method, 'GET');
  assert.equal(received.url, '/api/shuihuo-production/local-executors?source=script');
  assert.equal(received.username, 'contract-user');
  assert.equal(received.isOwner, 'false');
  assert.match(received.issuedAt, /^\d+$/);

  const pathname = '/api/shuihuo-production/local-executors';
  const payload = bridgePayload({
    username: received.username,
    issuedAt: received.issuedAt,
    isOwner: received.isOwner,
    method: received.method,
    pathname
  });
  const expectedSignature = crypto.createHmac('sha256', bridgeSecret).update(payload).digest('hex');
  assert.equal(received.signature, expectedSignature);
});
