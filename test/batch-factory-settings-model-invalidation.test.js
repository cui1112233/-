const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBatchFactoryControlsRouter } = require('../routes/batch-factory-controls');

function testAuth(req, _res, next) {
  req.username = 'tester';
  req.auth = { account: { username: 'tester', isOwner: false } };
  next();
}

function createStore() {
  const batch = {
    id: 'batch-1',
    settings: { videoModelId: 18, videoModelVersionId: 42, videoModelName: '旧模型', maxVideoDuration: 10 },
    items: [{
      id: 'item-1',
      settingsOverride: { quality: '保留小说覆盖' },
      videoSettingsOverrides: { '1': { restriction: '旧 VIDEO 覆盖' } },
      hookDraft: '保留爆款草稿',
      approvedHookScript: '保留已审核爆款开头',
      hookMeta: { factConstraints: ['保留'] },
      directorResult: { storyboard: [{ id: 1, duration_sec: 10 }] },
      promptVersions: {
        hook: { id: 'batch-hook-adaptation', version: 3, source: 'system' },
        'batch-viral-director': { id: 'batch-viral-director', version: 2, source: 'system' },
        scriptPrompt: { id: 'standard-short-drama', version: 4, source: 'personal' }
      },
      videoPromptErrors: { '1': '旧错误' },
      production: { projectId: 88 },
      productionResults: [{ index: 1, segmentId: 99 }],
      productionSubmissionError: '旧提交错误',
      status: 'complete',
      error: '旧错误'
    }]
  };
  return {
    batch,
    getBatch(_username, id) { return id === batch.id ? batch : null; },
    updateBatch(_username, _id, mutate) { mutate(batch); },
    updateItem(_username, _batchId, itemId, mutate) {
      const item = batch.items.find(entry => entry.id === itemId);
      if (item) mutate(item);
    },
    appendItemActivity() {}
  };
}

async function put(router, path, body) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Go 标记模型能力变化后 Node 只执行兼容失效效果并保留已审核 Hook', async () => {
  const store = createStore();
  const router = createBatchFactoryControlsRouter({
    store,
    authenticate: testAuth,
    persistSettings: async () => ({
      settings: {
        videoModelId: 18,
        videoModelVersionId: 42,
        videoModelName: 'Seedance 2.0',
        maxVideoDuration: 15
      },
      directorRegenerationRequired: true
    }),
    persistOverride: async () => ({})
  });

  const response = await put(router, '/batches/batch-1/settings', { settings: { videoModelId: 18 } });
  assert.equal(response.status, 200);
  assert.equal(response.body.batch.settings.videoModelName, 'Seedance 2.0');

  const item = store.batch.items[0];
  assert.equal(item.hookDraft, '保留爆款草稿');
  assert.equal(item.approvedHookScript, '保留已审核爆款开头');
  assert.deepEqual(item.hookMeta, { factConstraints: ['保留'] });
  assert.equal(item.directorResult, null);
  assert.deepEqual(item.videoSettingsOverrides, {});
  assert.deepEqual(item.promptVersions, {
    hook: { id: 'batch-hook-adaptation', version: 3, source: 'system' }
  });
  assert.deepEqual(item.videoPromptErrors, {});
  assert.equal(item.production, null);
  assert.deepEqual(item.productionResults, []);
  assert.equal(item.productionSubmissionError, null);
  assert.equal(item.status, 'pending');
  assert.equal(item.error, '');
  assert.deepEqual(item.settingsOverride, { quality: '保留小说覆盖' });
});

test('Go 未标记失效时 Node 不清空现有导演结果', async () => {
  const store = createStore();
  const originalDirector = store.batch.items[0].directorResult;
  const originalPromptVersions = store.batch.items[0].promptVersions;
  const router = createBatchFactoryControlsRouter({
    store,
    authenticate: testAuth,
    persistSettings: async () => ({
      settings: { videoModelId: 18, videoModelVersionId: 42, videoModelName: 'Seedance 2.0', maxVideoDuration: 10 },
      directorRegenerationRequired: false
    }),
    persistOverride: async () => ({})
  });

  const response = await put(router, '/batches/batch-1/settings', { settings: { quality: '8K' } });
  assert.equal(response.status, 200);
  assert.equal(store.batch.items[0].directorResult, originalDirector);
  assert.equal(store.batch.items[0].promptVersions, originalPromptVersions);
  assert.equal(store.batch.items[0].production.projectId, 88);
}
