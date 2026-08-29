const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBatchFactoryControlsRouter } = require('../routes/batch-factory-controls');

function createStore() {
  const batch = {
    id: 'batch-1',
    settings: {
      videoModelId: 18,
      videoModelVersionId: 1,
      videoModelName: '旧模型名称',
      maxVideoDuration: 10,
      aspectRatio: '9:16',
      prefixEnabled: true
    },
    items: [{
      id: 'item-1',
      settingsOverride: { quality: '旧画质', negativeEnabled: false },
      videoSettingsOverrides: { '1': { restriction: '旧限制' } },
      directorResult: { storyboard: [{ id: 1 }] }
    }]
  };
  const writes = { batch: 0, item: 0 };
  return {
    batch,
    writes,
    getBatch(_username, id) { return id === batch.id ? batch : null; },
    updateBatch(_username, _id, mutate) { writes.batch += 1; mutate(batch); },
    updateItem(_username, _batchId, itemId, mutate) {
      writes.item += 1;
      const item = batch.items.find(entry => entry.id === itemId);
      if (item) mutate(item);
    },
    appendItemActivity() {},
    normalizeSettings() { throw new Error('Node must not normalize migrated settings'); }
  };
}

function testAuth(req, _res, next) {
  req.username = 'tester';
  req.auth = { account: { username: 'tester', isOwner: false } };
  next();
}

async function request(router, path, body) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('生产统一设置只持久化到 Go/MySQL，不再写旧 batch-factory.json', async () => {
  const store = createStore();
  const calls = [];
  const router = createBatchFactoryControlsRouter({
    store,
    authenticate: testAuth,
    persistSettings: async (payload, _req, batchId) => {
      calls.push({ payload, batchId });
      return {
        videoModelId: 19,
        videoModelVersionId: 52,
        videoModelName: 'Go 模型中心名称',
        maxVideoDuration: 15,
        fixedSingleVideo: true,
        exactDuration: 15,
        aspectRatio: '16:9',
        prefixEnabled: false
      };
    },
    persistOverride: async () => ({})
  });

  const response = await request(router, '/batches/batch-1/settings', {
    settings: {
      videoModelId: 19,
      videoModelVersionId: 999,
      videoModelName: '浏览器伪造名称',
      maxVideoDuration: 60,
      fixedSingleVideo: true,
      aspectRatio: '16:9',
      prefixEnabled: false
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].batchId, 'batch-1');
  assert.equal(calls[0].payload.settings.videoModelId, 19);
  assert.equal(calls[0].payload.previous.videoModelName, '旧模型名称');
  assert.equal(response.body.batch.settings.videoModelName, 'Go 模型中心名称');
  assert.equal(response.body.batch.settings.maxVideoDuration, 15);

  // Legacy JSON remains a fallback snapshot for old batches only. Migrated
  // settings are no longer written to it.
  assert.equal(store.writes.batch, 0);
  assert.equal(store.batch.settings.videoModelId, 18);
  assert.equal(store.batch.settings.videoModelName, '旧模型名称');
});

test('单书和 VIDEO override 只写 Go/MySQL，响应使用 Go 返回结果', async () => {
  const store = createStore();
  const calls = [];
  const router = createBatchFactoryControlsRouter({
    store,
    authenticate: testAuth,
    persistSettings: async () => ({}),
    persistOverride: async (payload, _req, scope) => {
      calls.push({ payload, scope });
      if (scope.videoId === undefined) return { quality: '', qualityEnabled: false };
      return { aspectRatio: '16:9', negativeEnabled: false };
    }
  });

  let response = await request(router, '/batches/batch-1/items/item-1/overrides', {
    settings: { quality: '', qualityEnabled: false },
    inheritKeys: ['negativeEnabled']
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.item.settingsOverride, { quality: '', qualityEnabled: false });
  assert.deepEqual(calls[0], {
    payload: {
      settings: { quality: '', qualityEnabled: false },
      previous: { quality: '旧画质', negativeEnabled: false },
      inheritKeys: ['negativeEnabled']
    },
    scope: { batchId: 'batch-1', itemId: 'item-1' }
  });

  response = await request(router, '/batches/batch-1/items/item-1/videos/1/overrides', {
    settings: { aspectRatio: '16:9', negativeEnabled: false },
    inheritKeys: ['restriction']
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.item.videoSettingsOverrides['1'], { aspectRatio: '16:9', negativeEnabled: false });
  assert.deepEqual(calls[1], {
    payload: {
      settings: { aspectRatio: '16:9', negativeEnabled: false },
      previous: { restriction: '旧限制' },
      inheritKeys: ['restriction']
    },
    scope: { batchId: 'batch-1', itemId: 'item-1', videoId: '1' }
  });

  assert.equal(store.writes.item, 0);
  assert.deepEqual(store.batch.items[0].settingsOverride, { quality: '旧画质', negativeEnabled: false });
  assert.deepEqual(store.batch.items[0].videoSettingsOverrides['1'], { restriction: '旧限制' });
});

test('Go 持久化服务错误状态和消息原样返回，不回退到 Node 本地写入', async () => {
  const store = createStore();
  const router = createBatchFactoryControlsRouter({
    store,
    authenticate: testAuth,
    persistSettings: async () => {
      const error = new Error('所选视频模型未配置单次最大生成时长');
      error.statusCode = 409;
      throw error;
    },
    persistOverride: async () => ({})
  });

  const response = await request(router, '/batches/batch-1/settings', { settings: { videoModelId: 19 } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, '所选视频模型未配置单次最大生成时长');
  assert.equal(store.writes.batch, 0);
  assert.equal(store.batch.settings.videoModelId, 18);
});
