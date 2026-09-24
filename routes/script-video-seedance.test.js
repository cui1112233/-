const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createScriptVideoRouter } = require('./script-video');

test('script video submits Seedance through the configured YFAI adapter', async () => {
  let submitted;
  const router = createScriptVideoRouter({
    authenticate: (req, _res, next) => {
      req.username = 'owner';
      req.auth = { username: 'owner', account: { username: 'owner', isOwner: true } };
      next();
    },
    memberStore: { canUseApi: () => true },
    accountStore: { getInternalAccount: () => ({ username: 'owner', isOwner: true }) },
    configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [{ id: 'seedance-2-0-official', kind: 'video', enabled: true, credential: 'yfai-test-key' }] }),
    yfaiSubmit: async options => {
      submitted = options;
      return { statusCode: 200, text: JSON.stringify({ code: 200, data: { task_id: 'task-seedance-1' } }) };
    }
  });
  const app = express();
  app.use(express.json());
  app.locals.novelPanelPremiumStore = {
    syncReferenceAssetUrlToTos: async (username, imageUrl) => {
      assert.equal(username, 'owner');
      assert.equal(imageUrl, '/api/novel-panel/reference-assets/file/character/wife/main');
      return 'https://assets.example/reference-assets/owner/character/wife/main.png?signature=1';
    }
  };
  app.use('/api/script-video', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/script-video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelKey: 'seedance-2-0-official',
        prompt: '夜晚的城市雨巷',
        imageUrls: ['/api/novel-panel/reference-assets/file/character/wife/main']
      })
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, taskId: 'yfai:task-seedance-1', provider: 'yfai_seedance' });
    assert.equal(submitted.apiKey, 'yfai-test-key');
    assert.equal(submitted.payload.params.mode, 'reference');
    assert.deepEqual(submitted.payload.params.images, ['https://assets.example/reference-assets/owner/character/wife/main.png?signature=1']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
