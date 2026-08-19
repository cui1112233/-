const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createAccountStore } = require('../lib/account-store');
const { createAuthRuntime } = require('../lib/shared');
const { createAuthRouter } = require('../routes/auth');
const { createChatRouter } = require('../routes/chat');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
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
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close(error => {
            if (error) return reject(error);
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function createFixture(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-model-connection-routes-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json')
  });
  const savedConfig = {
    provider: 'text-saved-provider',
    baseUrl: 'https://text-saved.example/v1',
    model: 'text-saved-model',
    apiKey: 'text-saved-key',
    image: {
      provider: 'openai_compatible',
      baseUrl: 'https://image-saved.example/v1',
      model: 'image-saved-model',
      apiKey: 'image-saved-key'
    }
  };
  const textCalls = [];
  const imageCalls = [];
  const configSnapshot = structuredClone(savedConfig);
  const app = express();
  app.locals.authRuntime = authRuntime;
  app.use(express.json());
  app.use('/api/login', createAuthRouter(authRuntime));
  app.use('/api', createChatRouter({
    configReader(username) {
      assert.equal(username, 'choushiyiguai1');
      return savedConfig;
    },
    async upstreamRequest(config, payload, responseCollector) {
      textCalls.push({ config: structuredClone(config), payload: structuredClone(payload), responseCollector });
      return {
        statusCode: 200,
        text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '文本连接成功' } }] })
      };
    },
    async modelsRequest(config, responseCollector) {
      imageCalls.push({ config: structuredClone(config), responseCollector, argumentCount: arguments.length });
      return {
        statusCode: 200,
        text: JSON.stringify({ data: [{ id: 'image-body-model' }] })
      };
    }
  }));
  return { app, savedConfig, configSnapshot, textCalls, imageCalls };
}

async function login(app) {
  const response = await request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username: 'choushiyiguai1', password: '123456' }
  });
  assert.equal(response.status, 200);
  return response.body.token;
}

test('authenticated text and image connection tests isolate configurations without saving them', async t => {
  const fixture = createFixture(t);
  const token = await login(fixture.app);

  const text = await request(fixture.app, {
    method: 'POST',
    requestPath: '/api/test/text',
    token,
    body: {
      provider: 'text-body-provider',
      baseUrl: 'https://text-body.example/v1',
      model: 'text-body-model',
      apiKey: 'text-body-key',
      image: {
        baseUrl: 'https://must-not-be-used.example/v1',
        model: 'must-not-be-used',
        apiKey: 'must-not-be-used-key'
      }
    }
  });
  assert.equal(text.status, 200);
  assert.deepEqual(text.body, {
    ok: true,
    kind: 'text',
    message: { role: 'assistant', content: '文本连接成功' }
  });
  assert.equal(fixture.textCalls.length, 1);
  assert.equal(fixture.imageCalls.length, 0);
  assert.deepEqual(fixture.textCalls[0].config, {
    provider: 'text-body-provider',
    baseUrl: 'https://text-body.example/v1',
    model: 'text-body-model',
    apiKey: 'text-body-key'
  });
  assert.deepEqual(fixture.textCalls[0].payload, {
    model: 'text-body-model',
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 5
  });

  const alias = await request(fixture.app, {
    method: 'POST',
    requestPath: '/api/test',
    token,
    body: {}
  });
  assert.equal(alias.status, 200);
  assert.equal(alias.body.kind, 'text');
  assert.deepEqual(fixture.textCalls[1].config, {
    provider: 'text-saved-provider',
    baseUrl: 'https://text-saved.example/v1',
    model: 'text-saved-model',
    apiKey: 'text-saved-key'
  });

  const image = await request(fixture.app, {
    method: 'POST',
    requestPath: '/api/test/image',
    token,
    body: {
      provider: 'must-not-be-used',
      baseUrl: 'https://must-not-be-used.example/v1',
      model: 'must-not-be-used',
      apiKey: 'must-not-be-used-key',
      image: {
        provider: 'openai_compatible',
        baseUrl: 'https://image-body.example/v1',
        model: 'image-body-model',
        apiKey: 'image-body-key'
      }
    }
  });
  assert.equal(image.status, 200);
  assert.deepEqual(image.body, {
    ok: true,
    kind: 'image',
    modelListed: true,
    message: '生图模型连接成功，当前模型已在模型目录中找到。'
  });
  assert.equal(fixture.textCalls.length, 2);
  assert.equal(fixture.imageCalls.length, 1);
  assert.equal(fixture.imageCalls[0].argumentCount, 2);
  assert.deepEqual(fixture.imageCalls[0].config, {
    provider: 'openai_compatible',
    baseUrl: 'https://image-body.example/v1',
    model: 'image-body-model',
    apiKey: 'image-body-key'
  });
  assert.doesNotMatch(JSON.stringify(image.body), /(?:text|image)-(?:saved|body)-key/);
  assert.deepEqual(fixture.savedConfig, fixture.configSnapshot);
});
