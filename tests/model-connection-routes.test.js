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
const chatRouter = require('../routes/chat');
const { createChatRouter } = chatRouter;

const DEFAULT_CONFIG = {
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

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    let payload;
    try {
      payload = body === undefined ? '' : JSON.stringify(body);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;

    function closeThen(callback) {
      if (!server.listening) return callback();
      server.close(error => {
        if (error) return reject(error);
        callback();
      });
    }

    function succeed(value) {
      if (settled) return;
      settled = true;
      closeThen(() => resolve(value));
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      closeThen(() => reject(error));
    }

    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      let req;
      try {
        req = http.request({
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
          response.once('error', fail);
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              succeed({ status: response.statusCode, body: text ? JSON.parse(text) : null });
            } catch (error) {
              fail(error);
            }
          });
        });
      } catch (error) {
        fail(error);
        return;
      }
      req.once('error', fail);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function createFixture(t, { config = DEFAULT_CONFIG, textReply, imageReply } = {}) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-model-connection-routes-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json')
  });
  const savedConfig = structuredClone(config);
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
      if (textReply) return textReply(config, payload, responseCollector);
      return {
        statusCode: 200,
        text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '文本连接成功' } }] })
      };
    },
    async modelsRequest(config, responseCollector) {
      imageCalls.push({ config: structuredClone(config), responseCollector, argumentCount: arguments.length });
      if (imageReply) return imageReply(config, responseCollector);
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

test('HTTP helper rejects malformed JSON replies without leaving its temporary server open', async () => {
  const app = express();
  app.get('/invalid-json', (req, res) => res.type('text/plain').send('not json'));

  await assert.rejects(
    request(app, { requestPath: '/invalid-json' }),
    SyntaxError
  );
});

test('HTTP helper closes its temporary server when request creation fails', async () => {
  const app = express();

  await assert.rejects(
    request(app, { requestPath: '/', method: 'GET\ninvalid' }),
    { code: 'ERR_INVALID_HTTP_TOKEN' }
  );
});

test('default chat module remains an Express router and exposes its factory', () => {
  assert.equal(typeof chatRouter, 'function');
  assert.ok(Array.isArray(chatRouter.stack));
  assert.equal(typeof chatRouter.createChatRouter, 'function');
  assert.equal(chatRouter.createChatRouter, createChatRouter);
});

test('model connection test routes require authentication', async t => {
  const fixture = createFixture(t);

  const response = await request(fixture.app, {
    method: 'POST',
    requestPath: '/api/test/image',
    body: { image: {} }
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Unauthorized — invalid or expired token' });
  assert.equal(fixture.textCalls.length, 0);
  assert.equal(fixture.imageCalls.length, 0);
});

test('image connection rejects missing image configuration without using text fields', async t => {
  const fixture = createFixture(t, {
    config: { ...DEFAULT_CONFIG, image: {} }
  });
  const token = await login(fixture.app);

  const response = await request(fixture.app, {
    method: 'POST',
    requestPath: '/api/test/image',
    token,
    body: {
      baseUrl: 'https://text-fields-must-not-count.example/v1',
      model: 'text-fields-must-not-count',
      apiKey: 'text-fields-must-not-count-key',
      image: {}
    }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    ok: false,
    kind: 'image',
    error: '请填写完整的生图服务地址、模型和 API Key。'
  });
  assert.equal(fixture.imageCalls.length, 0);
});

test('text connection turns upstream status failures and request errors into safe 502 responses', async t => {
  const replies = [
    { statusCode: 401, text: JSON.stringify({ error: { message: 'invalid key must not be returned' } }) },
    new Error('connection failure with text-saved-key')
  ];
  const fixture = createFixture(t, {
    textReply() {
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    }
  });
  const token = await login(fixture.app);

  const upstreamFailure = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/text', token, body: {}
  });
  assert.equal(upstreamFailure.status, 502);
  assert.deepEqual(upstreamFailure.body, {
    ok: false,
    kind: 'text',
    error: '上游模型服务请求失败（状态 401）。',
    type: 'upstream_error'
  });

  const requestFailure = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/text', token, body: {}
  });
  assert.equal(requestFailure.status, 502);
  assert.deepEqual(requestFailure.body, {
    ok: false,
    kind: 'text',
    error: '模型服务连接失败，请检查服务地址、网络和代理设置。',
    type: 'upstream_connection_error'
  });
  assert.doesNotMatch(JSON.stringify({ upstreamFailure, requestFailure }), /text-saved-key|invalid key must not be returned/);
});

test('image connection turns invalid upstream catalogs into safe 502 responses', async t => {
  const replies = [
    { statusCode: 403, text: JSON.stringify({ error: { message: 'image-saved-key must not be returned' } }) },
    { statusCode: 200, text: 'not json' },
    { statusCode: 200, text: JSON.stringify({ data: {} }) }
  ];
  const fixture = createFixture(t, {
    imageReply() {
      return replies.shift();
    }
  });
  const token = await login(fixture.app);

  const upstreamFailure = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/image', token, body: { image: {} }
  });
  assert.equal(upstreamFailure.status, 502);
  assert.deepEqual(upstreamFailure.body, {
    ok: false,
    kind: 'image',
    error: '上游模型服务请求失败（状态 403）。',
    type: 'upstream_error'
  });

  const invalidJson = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/image', token, body: { image: {} }
  });
  assert.equal(invalidJson.status, 502);
  assert.deepEqual(invalidJson.body, {
    ok: false,
    kind: 'image',
    error: '上游生图模型未返回有效 JSON。'
  });

  const invalidCatalog = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/image', token, body: { image: {} }
  });
  assert.equal(invalidCatalog.status, 502);
  assert.deepEqual(invalidCatalog.body, {
    ok: false,
    kind: 'image',
    error: '上游生图模型目录格式无效。'
  });
  assert.doesNotMatch(JSON.stringify({ upstreamFailure, invalidJson, invalidCatalog }), /image-saved-key/);
});

test('image connection reports a successful catalog lookup when the configured model is absent', async t => {
  const fixture = createFixture(t, {
    imageReply() {
      return { statusCode: 200, text: JSON.stringify({ data: [{ id: 'another-image-model' }] }) };
    }
  });
  const token = await login(fixture.app);

  const response = await request(fixture.app, {
    method: 'POST', requestPath: '/api/test/image', token, body: { image: {} }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    kind: 'image',
    modelListed: false,
    message: '生图服务连接成功，但当前模型未出现在模型目录中，请确认模型名称或供应商支持。'
  });
});

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
