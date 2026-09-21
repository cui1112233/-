const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createConfigRouter } = require('./config');

test('manager can refresh normalized quota state for every configured model without exposing credentials', async () => {
  const router = createConfigRouter({
    authenticate: (req, _res, next) => { req.username = 'manager-a'; req.auth = { account: {} }; next(); },
    memberStore: { getMember: () => ({ active: true, role: 'manager' }) },
    configReader: () => ({ modelCatalog: [{ id: 'one', kind: 'video', credential: 'secret' }] }),
    quotaReader: async models => models.map(model => ({ modelId: model.id, status: 'available', supported: true, available: 7, total: 10, percent: 70 }))
  });
  const app = express();
  app.use('/api/config', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config/models/quotas`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { quotas: [{ modelId: 'one', status: 'available', supported: true, available: 7, total: 10, percent: 70 }] });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
