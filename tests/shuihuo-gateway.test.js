const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createPresetStore } = require('../lib/preset-store');
const { readConfig, writeConfig } = require('../lib/shared');
const { seedSystemPresets } = require('../lib/system-preset-catalog');
const { systemPromptBodyForRequest, upstreamTimeoutForRequest } = require('../routes/shuihuo-production');

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

function startSmartSegmentationStub(t, secret) {
  let receivedBody;
  const ready = new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const issuedAt = req.headers['x-qiantie-issued-at'];
      const payload = ['choushiyiguai1', issuedAt, 'false', req.method, req.url].join('\n');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(req.headers['x-qiantie-signature'], expected);
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'PUT' && req.url === '/api/shuihuo-production/account-ai-config') {
          res.end(JSON.stringify({ hasApiKey: true }));
          return;
        }
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.end(JSON.stringify({ status: 'candidate', candidates: [] }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ targetBaseUrl: `http://127.0.0.1:${server.address().port}`, receivedBody: () => receivedBody });
    });
  });
  return ready;
}

function startAccountAIConfigSyncStub(t, secret) {
  const calls = [];
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const issuedAt = req.headers['x-qiantie-issued-at'];
      const payload = ['choushiyiguai1', issuedAt, 'false', req.method, req.url].join('\n');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(req.headers['x-qiantie-signature'], expected);
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        calls.push({ method: req.method, pathname: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'PUT' && req.url === '/api/shuihuo-production/account-ai-config') {
          res.end(JSON.stringify({ provider: 'custom', baseUrl: 'https://models.example.com/v1', model: 'example-text', hasApiKey: true }));
          return;
        }
        if (req.method === 'POST' && req.url === '/api/shuihuo-production/projects/12/prompt-candidates/image') {
          res.end(JSON.stringify({ candidates: [] }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'unexpected route' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ targetBaseUrl: `http://127.0.0.1:${server.address().port}`, calls });
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

test('smart segmentation gateway replaces browser prompt data with the published system preset', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-smart-segmentation-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const secret = 'test-bridge-secret';
  const backend = await startSmartSegmentationStub(t, secret);
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    shuihuoGateway: { targetBaseUrl: backend.targetBaseUrl, bridgeSecret: secret }
  });
  const priorConfig = readConfig('choushiyiguai1');
  t.after(() => writeConfig('choushiyiguai1', priorConfig));
  writeConfig('choushiyiguai1', {
    ...priorConfig,
    provider: 'custom', baseUrl: 'https://models.example.com/v1', model: 'example-text', apiKey: 'test-account-key'
  });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  const result = await request(app, {
    method: 'POST',
    requestPath: '/api/shuihuo-production/projects/12/segmentation/smart',
    token: JSON.parse(login.body).token,
    body: { modelId: 7, text: '第一段', systemPrompt: 'browser supplied prompt' }
  });
  assert.equal(result.status, 200);
  const forwarded = backend.receivedBody();
  assert.equal(forwarded.systemPromptId, 'shuihuo-smart-segmentation');
  assert.match(forwarded.systemPrompt, /小说视频生产的智能分段服务/);
  assert.doesNotMatch(forwarded.systemPrompt, /browser supplied prompt/);
});

test('settings and prompt inference synchronize one account AI configuration without exposing its key', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-account-ai-config-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const secret = 'test-bridge-secret';
  const backend = await startAccountAIConfigSyncStub(t, secret);
  const priorConfig = readConfig('choushiyiguai1');
  t.after(() => writeConfig('choushiyiguai1', priorConfig));
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    shuihuoGateway: { targetBaseUrl: backend.targetBaseUrl, bridgeSecret: secret }
  });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  const token = JSON.parse(login.body).token;
  const saved = await request(app, {
    method: 'POST', requestPath: '/api/config', token,
    body: { provider: 'custom', baseUrl: 'https://models.example.com/v1', model: 'example-text', apiKey: 'test-account-key' }
  });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(saved.body, /test-account-key/);
  assert.equal(readConfig('choushiyiguai1').apiKey, 'test-account-key');

  const inference = await request(app, {
    method: 'POST', requestPath: '/api/shuihuo-production/projects/12/prompt-candidates/image', token,
    body: { modelId: 7 }
  });
  assert.equal(inference.status, 200);
  assert.deepEqual(backend.calls.map(call => [call.method, call.pathname]), [
    ['PUT', '/api/shuihuo-production/account-ai-config'],
    ['PUT', '/api/shuihuo-production/account-ai-config'],
    ['POST', '/api/shuihuo-production/projects/12/prompt-candidates/image']
  ]);
  assert.equal(backend.calls[0].body.apiKey, 'test-account-key');
  assert.match(backend.calls[2].body.systemPrompt, /AI 绘画提示词生成器/);
});

test('settings save a separate image provider without exposing or discarding its key', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-account-image-config-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const secret = 'test-bridge-secret';
  const backend = await startAccountAIConfigSyncStub(t, secret);
  const priorConfig = readConfig('choushiyiguai1');
  t.after(() => writeConfig('choushiyiguai1', priorConfig));
  writeConfig('choushiyiguai1', { ...priorConfig, apiKey: '' });
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    shuihuoGateway: { targetBaseUrl: backend.targetBaseUrl, bridgeSecret: secret }
  });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  const token = JSON.parse(login.body).token;
  const image = {
    mode: 'custom',
    provider: 'openai_compatible',
    displayName: 'My image gateway',
    baseUrl: 'https://images.example/v1',
    model: 'image-model',
    apiKey: 'image-secret'
  };

  const firstSave = await request(app, { method: 'POST', requestPath: '/api/config', token, body: { image } });
  assert.equal(firstSave.status, 200);
  assert.doesNotMatch(firstSave.body, /image-secret/);
  assert.equal(JSON.parse(firstSave.body).image.hasApiKey, true);
  assert.equal(readConfig('choushiyiguai1').image.apiKey, 'image-secret');
  assert.deepEqual(backend.calls[0].body, { image });

  const secondSave = await request(app, {
    method: 'POST', requestPath: '/api/config', token,
    body: { image: { ...image, apiKey: '' } }
  });
  assert.equal(secondSave.status, 200);
  assert.doesNotMatch(secondSave.body, /image-secret/);
  assert.equal(readConfig('choushiyiguai1').image.apiKey, 'image-secret');
  assert.equal(backend.calls[1].body.image.apiKey, 'image-secret');
});

test('water-production prompt routes inject only published system presets', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-prompt-routes-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const presetStore = createPresetStore({ systemDir });
  seedSystemPresets(presetStore, 'owner');

  const assetBody = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets', { modelId: 7, systemPrompt: 'browser supplied prompt' }, presetStore);
  assert.equal(assetBody.systemPromptId, 'shuihuo-extract-assets');
  assert.match(assetBody.systemPrompt, /小说内容分析师/);
  assert.match(assetBody.systemPrompt, /人物提取/);
  assert.doesNotMatch(assetBody.systemPrompt, /browser supplied prompt/);

  const plannedAssets = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets-and-bindings', { modelId: 7, assetPresetId: 'shuihuo-extract-assets', systemPrompt: 'browser supplied prompt' }, presetStore);
  assert.equal(plannedAssets.systemPromptId, 'shuihuo-extract-assets,shuihuo-asset-binding');
  assert.match(plannedAssets.systemPrompt, /小说内容分析师/);
  assert.match(plannedAssets.systemPrompt, /分镜资产绑定服务/);
  assert.match(plannedAssets.systemPrompt, /sceneMode/);
  assert.match(plannedAssets.systemPrompt, /沿用上一段 scene/);
  assert.doesNotMatch(plannedAssets.systemPrompt, /browser supplied prompt/);

  const imageBody = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/image', { modelId: 7, systemPrompt: 'browser supplied prompt' }, presetStore);
  assert.equal(imageBody.systemPromptId, 'shuihuo-image-prompt');
  assert.match(imageBody.systemPrompt, /AI 绘画提示词生成器/);
  assert.match(imageBody.systemPrompt, /图片设计：/);
  assert.doesNotMatch(imageBody.systemPrompt, /browser supplied prompt/);

  const videoBody = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/video', { modelId: 7, systemPrompt: 'browser supplied prompt' }, presetStore);
  assert.equal(videoBody.systemPromptId, 'shuihuo-video-prompt');
  assert.match(videoBody.systemPrompt, /高分镜连续情绪场景推理执行器/);
  assert.match(videoBody.systemPrompt, /video_desc/);
  assert.doesNotMatch(videoBody.systemPrompt, /browser supplied prompt/);

  const unsupportedNegative = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/negative', { modelId: 7, systemPrompt: 'browser supplied prompt' }, presetStore);
  assert.equal(unsupportedNegative.systemPrompt, 'browser supplied prompt');
  assert.equal(unsupportedNegative.systemPromptId, undefined);
});

test('water-production prompt routes accept a published slot-owned preset selection', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-selected-prompt-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const presetStore = createPresetStore({ systemDir });
  seedSystemPresets(presetStore, 'owner');
  const custom = presetStore.createDraft('owner', {
    id: 'custom-video-prompt',
    module: 'shuihuo-production',
    name: '剧本分镜-Seedance 2.0专业版',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'CUSTOM_VIDEO_PROMPT_BODY',
    protocolLock: { slot: 'shuihuo.prompt.video' }
  });
  const draft = presetStore.createDraft('owner', {
    id: 'draft-image-prompt',
    module: 'shuihuo-production',
    name: '未发布图片提示词',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'DRAFT_IMAGE_BODY',
    protocolLock: { slot: 'shuihuo.prompt.image' }
  });
  presetStore.publish('owner', custom.id, custom.version);

  const selected = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/video', {
    modelId: 7,
    promptPresetId: custom.id,
    systemPrompt: 'browser supplied prompt'
  }, presetStore);
  assert.equal(selected.promptPresetId, custom.id);
  assert.equal(selected.systemPromptId, custom.id);
  assert.match(selected.systemPrompt, /CUSTOM_VIDEO_PROMPT_BODY/);
  assert.doesNotMatch(selected.systemPrompt, /browser supplied prompt/);

  assert.throws(() => systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/image', {
    modelId: 7,
    promptPresetId: custom.id
  }, presetStore), error => error?.status === 409 && /画面提示词/.test(error.message));
  assert.throws(() => systemPromptBodyForRequest('/api/shuihuo-production/projects/12/prompt-candidates/image', {
    modelId: 7,
    promptPresetId: draft.id
  }, presetStore), error => error?.status === 409 && /画面提示词/.test(error.message));
});

test('scoped asset analysis and binding use only their published server presets', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-asset-scopes-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const presetStore = createPresetStore({ systemDir });
  seedSystemPresets(presetStore, 'owner');

  const propOnly = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets', {
    modelId: 7, scope: 'prop', systemPrompt: 'browser supplied prompt'
  }, presetStore);
  assert.equal(propOnly.scope, 'prop');
  assert.equal(propOnly.systemPromptId, 'shuihuo-extract-assets');
  assert.match(propOnly.systemPrompt, /小说内容分析师/);
  assert.match(propOnly.systemPrompt, /道具提取/);
  assert.doesNotMatch(propOnly.systemPrompt, /browser supplied prompt/);

  const binding = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/bindings', {
    modelId: 7, systemPrompt: 'browser supplied prompt'
  }, presetStore);
  assert.equal(binding.systemPromptId, 'shuihuo-asset-binding');
  assert.match(binding.systemPrompt, /分镜资产绑定服务/);
  assert.doesNotMatch(binding.systemPrompt, /browser supplied prompt/);

  assert.throws(() => systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets', {
    modelId: 7, scope: 'invalid'
  }, presetStore), error => error?.status === 400 && /分析范围/.test(error.message));
});

test('asset image generation injects only the published character-sheet preset', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-character-sheet-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const presetStore = createPresetStore({ systemDir });
  seedSystemPresets(presetStore, 'owner');
  const body = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/assets/generate', {
    assetIds: [7], modelId: 9, aspectRatio: '16:9', characterSheetPresetId: 'shuihuo-character-three-view', systemPrompt: 'browser supplied prompt'
  }, presetStore);
  assert.equal(body.systemPromptId, 'shuihuo-character-three-view');
  assert.match(body.systemPrompt, /全身标准三视图/);
  assert.doesNotMatch(body.systemPrompt, /browser supplied prompt/);
});

test('asset analysis resolves one published unified prompt and rejects an unpublished selection', t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-shuihuo-selected-assets-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const presetStore = createPresetStore({ systemDir });
  seedSystemPresets(presetStore, 'owner');
  const unified = presetStore.createDraft('owner', {
    id: 'custom-assets', module: 'shuihuo-production', name: '人物场景道具提取增强', kind: 'base',
    description: '', compatibleBaseIds: [], body: 'CUSTOM_UNIFIED_ASSET_BODY',
    protocolLock: { slot: 'shuihuo.asset.extraction' }
  });
  const draft = presetStore.createDraft('owner', {
    id: 'draft-assets', module: 'shuihuo-production', name: '未发布资产提取', kind: 'base',
    description: '', compatibleBaseIds: [], body: 'DRAFT_BODY',
    protocolLock: { slot: 'shuihuo.asset.extraction' }
  });
  presetStore.publish('owner', unified.id, unified.version);

  const selected = systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets', {
    modelId: 7,
    assetPresetId: unified.id,
    systemPrompt: 'browser supplied prompt'
  }, presetStore);
  assert.equal(selected.assetPresetId, unified.id);
  assert.equal(selected.systemPromptId, unified.id);
  assert.match(selected.systemPrompt, /CUSTOM_UNIFIED_ASSET_BODY/);
  assert.doesNotMatch(selected.systemPrompt, /browser supplied prompt/);

  assert.throws(() => systemPromptBodyForRequest('/api/shuihuo-production/projects/12/analysis/assets', {
    modelId: 7, assetPresetId: draft.id
  }, presetStore), error => error?.status === 409 && /人物场景、道具/.test(error.message));
});

test('gateway gives text-generation analysis routes the model response timeout', () => {
  assert.equal(upstreamTimeoutForRequest('POST', '/api/shuihuo-production/projects/12/analysis/assets'), 100_000);
  assert.equal(upstreamTimeoutForRequest('POST', '/api/shuihuo-production/projects/12/segmentation/smart'), 100_000);
  assert.equal(upstreamTimeoutForRequest('POST', '/api/shuihuo-production/projects/12/prompt-candidates/image'), 100_000);
  assert.equal(upstreamTimeoutForRequest('POST', '/api/shuihuo-production/projects/12/prompt-candidates/video'), 100_000);
  assert.equal(upstreamTimeoutForRequest('GET', '/api/shuihuo-production/projects/12'), 15_000);
});
