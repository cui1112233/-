const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createConfigRouter } = require('./config');

test('global production retention is saved per authenticated user and invalid values fall back to 7', async () => {
  const configs = new Map([['alice', { productionRetentionDays: 14 }], ['bob', {}]]);
  const router = createConfigRouter({
    authenticate: (req, _res, next) => { req.username = req.headers['x-user'] || 'alice'; req.auth = { account: {} }; next(); },
    memberStore: { getMember: () => ({ active: true, role: 'manager' }) },
    configReader: username => ({ ...(configs.get(username) || {}) }),
    configWriter: (username, config) => configs.set(username, config)
  });
  const app = express();
  app.use(express.json());
  app.use('/api/config', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'alice' }, body: JSON.stringify({ productionRetentionDays: 30 })
    });
    assert.equal(saved.status, 200);
    assert.equal(configs.get('alice').productionRetentionDays, 30);
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'bob' }, body: JSON.stringify({ productionRetentionDays: 99 })
    });
    assert.equal(invalid.status, 200);
    assert.equal(configs.get('bob').productionRetentionDays, 7);
    assert.equal((await (await fetch(`http://127.0.0.1:${server.address().port}/api/config`, { headers: { 'x-user': 'alice' } })).json()).productionRetentionDays, 30);
    const invalidExisting = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'alice' }, body: JSON.stringify({ productionRetentionDays: 99 })
    });
    assert.equal(invalidExisting.status, 200);
    assert.equal(configs.get('alice').productionRetentionDays, 7);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
