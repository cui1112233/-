const test = require('node:test');
const assert = require('node:assert/strict');

const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { createShuihuoProductionRouter, resolveShuihuoBaseUrl } = require('../routes/shuihuo-production');
const { listShuihuoProjects } = require('../routes/platform-projects');

test('Shuihuo chooses its isolated compatibility target before the shared Go API', () => {
  const previousCompat = process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL;
  const previousGo = process.env.QIANTIE_GO_BASE_URL;
  process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL = 'http://shuihuo-compat:4100';
  process.env.QIANTIE_GO_BASE_URL = 'http://go-api:4000';
  try {
    assert.equal(resolveShuihuoBaseUrl(), 'http://shuihuo-compat:4100');
    assert.equal(resolveShuihuoBaseUrl('http://explicit-gateway:4000'), 'http://shuihuo-compat:4100');
  } finally {
    if (previousCompat === undefined) delete process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL;
    else process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL = previousCompat;
    if (previousGo === undefined) delete process.env.QIANTIE_GO_BASE_URL;
    else process.env.QIANTIE_GO_BASE_URL = previousGo;
  }
});

test('platform project aggregation keeps a Shuihuo project lister', () => {
  assert.equal(typeof listShuihuoProjects, 'function');
});

test('Shuihuo converts an upstream authorization rejection into a service failure', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;

  const app = express();
  app.use(express.json());
  app.use('/api/shuihuo-production', createShuihuoProductionRouter({
    targetBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    bridgeSecret: 'test-bridge-secret',
    authenticate: (req, _res, next) => {
      req.auth = { account: { username: 'testuser', isOwner: false } };
      next();
    }
  }));
  const gateway = http.createServer(app);
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayPort = gateway.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/shuihuo-production/projects`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: '水货生产服务鉴权失败，请联系管理员检查服务连接' });
  } finally {
    await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('Shuihuo signs compatibility requests using the retained Go bridge contract', async () => {
  const upstream = http.createServer((req, res) => {
    const username = req.headers['x-qiantie-username'];
    const issuedAt = req.headers['x-qiantie-issued-at'];
    const isOwner = req.headers['x-qiantie-is-owner'] === 'true';
    const payload = [username, issuedAt, String(isOwner), req.method, req.url.split('?')[0]].join('\n');
    const expected = crypto.createHmac('sha256', 'test-bridge-secret').update(payload).digest('hex');
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(issuedAt));
    if (age > 60 || req.headers['x-qiantie-signature'] !== expected) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projects: [] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = express();
  app.use('/api/shuihuo-production', createShuihuoProductionRouter({
    targetBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
    bridgeSecret: 'test-bridge-secret',
    authenticate: (req, _res, next) => {
      req.auth = { account: { username: 'testuser', isOwner: false } };
      next();
    }
  }));
  const gateway = http.createServer(app);
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.address().port}/api/shuihuo-production/projects`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projects: [] });
  } finally {
    await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  }
});
