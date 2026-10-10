const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createScriptVideoRouter } = require('./script-video');

test('script video submits the selected Fanke provider model with account-scoped credentials', async () => {
  let submitted;
  const router = createScriptVideoRouter({
    authenticate: (req, _res, next) => {
      req.username = 'owner';
      req.auth = { username: 'owner', account: { username: 'owner', isOwner: true } };
      next();
    },
    memberStore: { canUseApi: () => true },
    accountStore: { getInternalAccount: () => ({ username: 'owner', isOwner: true }) },
    configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [{
      id: 'fanke-open-video', kind: 'video', enabled: true, credential: 'fanke-test-key',
      providerModel: { id: 'minimax-h3-768p', name: 'MiniMax H3-768p', durations: [8], resolutions: ['768p'], aspectRatios: ['9:16'], maxImageRefs: 2, promptMaxChars: 2000 }
    }] }),
    fankeSubmit: async options => {
      submitted = options;
      return { statusCode: 200, text: JSON.stringify({ success: true, jobId: 'fanke-job-1', status: 'submitted' }) };
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/script-video', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/script-video`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelKey: 'fanke-open-video', prompt: '夜晚的城市雨巷', duration: 8, resolution: '768p', aspectRatio: '9:16', imageUrls: ['https://assets.example/a.png'] })
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, taskId: 'fanke:fanke-job-1', provider: 'fanke_open_video' });
    assert.equal(submitted.apiKey, 'fanke-test-key');
    assert.deepEqual(submitted.payload, { model: 'minimax-h3-768p', prompt: '夜晚的城市雨巷', ratio: '9:16', duration: 8, resolution: '768p', imageUrls: ['https://assets.example/a.png'] });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
