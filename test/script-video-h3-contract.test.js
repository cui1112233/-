'use strict';

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
      apiAuth(req, _res, next) {
        req.username = 'tester';
        req.auth = { account: { username: 'tester', isOwner: true } };
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

async function makeApp(t, options = {}) {
  const createScriptVideoRouter = loadRouterFactory();
  const app = express();
  app.use(express.json());
  app.use('/api/script-video', createScriptVideoRouter({
    configReader: () => ({ video: { apiKey: '' } }),
    ...options
  }));
  const server = http.createServer(app);
  const base = await listen(server);
  t.after(() => close(server));
  return base;
}

test('MiniMax H3 zero-image submit selects no_pic without personal API key', async t => {
  const calls = [];
  const base = await makeApp(t, {
    h3Submit: async input => {
      calls.push(input);
      return { providerTaskId: 'remote-1', state: 'queued' };
    }
  });
  const response = await fetch(`${base}/api/script-video`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelKey: 'minimax-h3', prompt: '雨夜街道', imageUrls: [] })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, taskId: 'h3:remote-1', status: 'processing' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    account: { username: 'tester', isOwner: true },
    modelKey: 'minimax-h3',
    prompt: '雨夜街道',
    imageUrls: [],
    workflow: 'minimax_h3_lightx2v_no_pic'
  });
  assert.equal('apiKey' in calls[0], false);
  assert.equal('token' in calls[0], false);
});

test('MiniMax H3 with valid images selects v5_15s automatically', async t => {
  const calls = [];
  const base = await makeApp(t, {
    h3Submit: async input => {
      calls.push(input);
      return { providerTaskId: 'remote-2', state: 'queued' };
    }
  });
  const response = await fetch(`${base}/api/script-video`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelKey: 'minimax-h3', prompt: '人物回头', imageUrls: ['https://example.com/ref.png'] })
  });
  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflow, 'minimax_h3_lightx2v_v5_15s');
  assert.deepEqual(calls[0].imageUrls, ['https://example.com/ref.png']);
});

test('MiniMax H3 rejects invalid supplied images instead of downgrading to text-only', async t => {
  let called = false;
  const base = await makeApp(t, {
    h3Submit: async () => { called = true; return { providerTaskId: 'unexpected' }; }
  });
  const response = await fetch(`${base}/api/script-video`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelKey: 'minimax-h3', prompt: '人物回头', imageUrls: ['http://example.com/ref.png'] })
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('MiniMax H3 polling keeps running tasks processing', async t => {
  const base = await makeApp(t, {
    h3Poll: async () => ({ state: 'running', providerTaskId: 'remote-1' })
  });
  const response = await fetch(`${base}/api/script-video/h3%3Aremote-1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, taskId: 'h3:remote-1', status: 'processing' });
});

test('MiniMax H3 SUCCESS without durable result URL is never succeeded', async t => {
  const base = await makeApp(t, {
    h3Poll: async () => ({ state: 'succeeded', providerTaskId: 'remote-1', mediaUrl: '' })
  });
  const response = await fetch(`${base}/api/script-video/h3%3Aremote-1`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /视频|URL|地址/);
});

test('MiniMax H3 SUCCESS with durable HTTPS result URL becomes succeeded', async t => {
  const base = await makeApp(t, {
    h3Poll: async () => ({ state: 'succeeded', providerTaskId: 'remote-1', mediaUrl: 'https://cdn.example.com/video.mp4' })
  });
  const response = await fetch(`${base}/api/script-video/h3%3Aremote-1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    taskId: 'h3:remote-1',
    status: 'succeeded',
    videoUrl: 'https://cdn.example.com/video.mp4'
  });
});
