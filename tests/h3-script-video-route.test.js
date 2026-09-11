const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');

const { createScriptVideoRouter } = require('../routes/script-video');
const { H3_MODEL_KEY } = require('../lib/video-model-catalog');

function startApp(options) {
  const app = express();
  app.use(express.json());
  app.use('/api/script-video', createScriptVideoRouter({
    memberStore: { canUseApi: () => true },
    authenticate(req, _res, next) {
      req.username = 'alice';
      req.auth = { account: { username: 'alice', isOwner: true } };
      next();
    },
    ...options
  }));
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    baseURL: `http://127.0.0.1:${server.address().port}`
  })));
}

test('H3 script route submits without exposing the server token and polls AutoDL status', async t => {
  const calls = [];
  const h3App = await startApp({
    h3ApiKeyReader: () => 'server-only-h3-token',
    h3Submit: async input => {
      calls.push(['submit', input]);
      return { statusCode: 200, text: JSON.stringify({ code: 'Success', data: { task_id: 'task-1', status: 'QUEUED' } }) };
    },
    h3Request: async input => {
      calls.push(['poll', input]);
      return calls.filter(item => item[0] === 'poll').length === 1
        ? { statusCode: 200, text: JSON.stringify({ data: { task_id: 'task-1', status: 'RUNNING', results: [] } }) }
        : { statusCode: 200, text: JSON.stringify({ data: { task_id: 'task-1', status: 'SUCCESS', results: [{ type: 'video', url: 'https://cdn.example.test/task-1.mp4' }] } }) };
    }
  });
  t.after(() => h3App.server.close());

  const submitResponse = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '角色抬头', duration: 5, resolution: '480p竖' })
  });
  const submitted = await submitResponse.json();
  assert.equal(submitResponse.status, 202);
  assert.equal(submitted.taskId, 'h3:task-1');
  assert.equal(JSON.stringify(submitted).includes('server-only-h3-token'), false);
  assert.equal(calls[0][1].workflow, 'minimax_h3_lightx2v_no_pic');
  assert.deepEqual(calls[0][1].payload, { prompt: '角色抬头', duration: 5, resolution: '480p竖' });

  const processingResponse = await fetch(`${h3App.baseURL}/api/script-video/h3%3Atask-1`);
  assert.deepEqual(await processingResponse.json(), { ok: true, taskId: 'h3:task-1', status: 'processing' });
  const successResponse = await fetch(`${h3App.baseURL}/api/script-video/h3%3Atask-1`);
  assert.deepEqual(await successResponse.json(), { ok: true, taskId: 'h3:task-1', status: 'succeeded', videoUrl: 'https://cdn.example.test/task-1.mp4', provider: 'autodl_comfyui' });
  assert.equal(calls[1][1].taskId, 'task-1');
});

test('H3 script route reads the video API key from the personal-center config', async t => {
  let submitted;
  const h3App = await startApp({
    configReader: username => username === 'alice' ? { video: { ydApiKey: 'personal-center-yd-token', h3ApiKey: 'personal-center-h3-token' } } : {},
    h3ApiKeyReader: () => '',
    h3Submit: async input => {
      submitted = input;
      return { statusCode: 200, text: JSON.stringify({ data: { task_id: 'task-personal-config' } }) };
    }
  });
  t.after(() => h3App.server.close());

  const response = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '个人中心配置的 H3 镜头' })
  });

  assert.equal(response.status, 202);
  assert.equal(submitted.apiKey, 'personal-center-h3-token');
  assert.equal(JSON.stringify(await response.json()).includes('personal-center-h3-token'), false);
});

test('H3 script route switches to reference workflow when a valid image is supplied', async t => {
  let submitted;
  const h3App = await startApp({
    h3ApiKeyReader: () => 'server-only-h3-token',
    h3Submit: async input => {
      submitted = input;
      return { statusCode: 200, text: JSON.stringify({ data: { task_id: 'task-2' } }) };
    }
  });
  t.after(() => h3App.server.close());

  const response = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '人物转身', referenceImages: ['https://cdn.example.test/ref.png'] })
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).taskId, 'h3:task-2');
  assert.equal(submitted.workflow, 'minimax_h3_lightx2v_v5_15s');
  assert.equal(submitted.payload.ref_image_0, 'https://cdn.example.test/ref.png');
});

test('H3 script route accepts the maximum 15-second duration and returns the async task contract', async t => {
  let submitted;
  const h3App = await startApp({
    h3ApiKeyReader: () => 'server-only-h3-token',
    h3Submit: async input => {
      submitted = input;
      return { statusCode: 200, text: JSON.stringify({ data: { task_id: 'task-15' } }) };
    }
  });
  t.after(() => h3App.server.close());

  const response = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '十五秒镜头', duration: 15, resolution: '480p竖' })
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, taskId: 'h3:task-15', provider: 'autodl_comfyui' });
  assert.equal(submitted.payload.duration, 15);
});

test('H3 script route rejects duration above 15 seconds without submitting', async t => {
  let submitCount = 0;
  const h3App = await startApp({
    h3ApiKeyReader: () => 'server-only-h3-token',
    h3Submit: async () => { submitCount += 1; return { statusCode: 200, text: '{}' }; }
  });
  t.after(() => h3App.server.close());

  const response = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '超长镜头', duration: 16, resolution: '480p竖' })
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /1-15/);
  assert.equal(submitCount, 0);
});

test('H3 script route blocks submission when the server token is missing', async t => {
  let submitCount = 0;
  const h3App = await startApp({
    h3ApiKeyReader: () => '',
    h3Submit: async () => { submitCount += 1; return { statusCode: 200, text: '{}' }; }
  });
  t.after(() => h3App.server.close());

  const response = await fetch(`${h3App.baseURL}/api/script-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelKey: H3_MODEL_KEY, prompt: '测试' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /尚未配置/);
  assert.equal(submitCount, 0);
});
