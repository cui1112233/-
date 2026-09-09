'use strict';

// Baseline trigger: unified local-video handoff contract suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function installAuthStub() {
  const authPath = require.resolve('../middleware/auth');
  const original = require.cache[authPath];
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      apiAuth(req, res, next) {
        req.username = 'tester';
        req.auth = {
          username: 'tester',
          account: { username: 'tester', isOwner: true }
        };
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
  const routePath = require.resolve('../routes/script-video');
  delete require.cache[routePath];
  const route = require(routePath);
  restoreAuth();
  return route.createScriptVideoRouter;
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

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

test('local doubao submit creates a local executor job with the executor payload contract', async t => {
  const received = [];
  const goServer = http.createServer(async (req, res) => {
    received.push({ method: req.method, url: req.url, body: await readJSON(req) });
    if (req.method === 'POST' && req.url === '/api/shuihuo-production/local-executor-jobs') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'job-123', state: 'queued' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const goBase = await listen(goServer);
  t.after(() => close(goServer));

  const createScriptVideoRouter = loadRouterFactory();
  const app = express();
  app.use(express.json());
  app.use('/api/script-video', createScriptVideoRouter({
    shuihuoGateway: { targetBaseUrl: goBase, bridgeSecret: 'test-secret' }
  }));
  const appServer = http.createServer(app);
  const appBase = await listen(appServer);
  t.after(() => close(appServer));

  const response = await fetch(`${appBase}/api/script-video`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'local-doubao-executor-video',
      prompt: '镜头一：人物走进雨夜街道',
      bookId: 'book-1',
      videoId: 'video-1',
      model: 'doubao-video',
      duration: 8,
      aspectRatio: '16:9',
      resolution: '1080p'
    })
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    taskId: 'job-123',
    status: 'processing'
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/api/shuihuo-production/local-executor-jobs');
  assert.match(received[0].body.sourceTaskId, /^script-video:/);
  assert.equal(received[0].body.platform, 'doubao');
  assert.deepEqual(received[0].body.payload, {
    bookId: 'book-1',
    videoId: 'video-1',
    model: 'doubao-video',
    prompt: '镜头一：人物走进雨夜街道',
    duration: 8,
    aspectRatio: '16:9',
    resolution: '1080p'
  });
});

test('local executor succeeded job is mapped to succeeded with its artifact URL', async t => {
  const received = [];
  const goServer = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url });
    if (req.method === 'GET' && req.url === '/api/shuihuo-production/local-executor-jobs/job-123') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'job-123', state: 'succeeded', artifactId: 'artifact-9' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const goBase = await listen(goServer);
  t.after(() => close(goServer));

  const createScriptVideoRouter = loadRouterFactory();
  const app = express();
  app.use('/api/script-video', createScriptVideoRouter({
    shuihuoGateway: { targetBaseUrl: goBase, bridgeSecret: 'test-secret' },
    configReader: () => ({ video: { apiKey: '' } })
  }));
  const appServer = http.createServer(app);
  const appBase = await listen(appServer);
  t.after(() => close(appServer));

  const response = await fetch(`${appBase}/api/script-video/job-123`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    taskId: 'job-123',
    status: 'succeeded',
    videoUrl: '/api/shuihuo-production/local-executor-artifacts/artifact-9'
  });
  assert.deepEqual(received, [{
    method: 'GET',
    url: '/api/shuihuo-production/local-executor-jobs/job-123'
  }]);
});
