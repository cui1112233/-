const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createConfigRouter } = require('./config');

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/config', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('manager can refresh its account-specific Fanke video model catalog without persisting or returning the key', async () => {
  const config = {
    modelCatalogVersion: 1,
    modelCatalog: [{
      id: 'fanke-open-video',
      displayName: '梵客视频 API',
      credential: 'saved-private-key',
      providerModel: { id: 'minimax-h3-768p', name: 'MiniMax H3-768p' },
      enabled: true
    }]
  };
  let receivedKey = '';
  let writes = 0;
  const router = createConfigRouter({
    authenticate: (req, _res, next) => {
      req.username = 'manager-a';
      req.auth = { account: {} };
      next();
    },
    memberStore: { getMember: () => ({ active: true, role: 'manager' }) },
    configReader: () => config,
    configWriter: () => { writes += 1; },
    fetchFankeVideoModels: async ({ apiKey }) => {
      receivedKey = apiKey;
      return [{ id: 'minimax-h3-768p', name: 'MiniMax H3-768p', durations: [8] }];
    }
  });

  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/config/models/fanke-open-video/catalog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.models, [{ id: 'minimax-h3-768p', name: 'MiniMax H3-768p', durations: [8] }]);
    assert.equal(JSON.stringify(payload).includes('saved-private-key'), false);
  });
  assert.equal(receivedKey, 'saved-private-key');
  assert.equal(writes, 0);
});
