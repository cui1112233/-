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

function responseCollector() {
  return { statusCode: 200, text: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
}

test('enabled text models are rejected until their exact runtime configuration passes the model test', async () => {
  let config = {};
  const router = createConfigRouter({
    authenticate: (req, _res, next) => { req.username = 'manager-a'; req.auth = { account: {} }; next(); },
    memberStore: { getMember: () => ({ active: true, role: 'manager' }) },
    configReader: () => config,
    configWriter: (_username, nextConfig) => { config = nextConfig; },
    upstreamRequest: async () => responseCollector()
  });
  const model = { id: 'custom-text', kind: 'text', displayName: '文本', baseUrl: 'https://api.example.test/v1', modelId: 'example-text', credential: 'key-a', enabled: true };

  await withServer(router, async baseUrl => {
    const beforeTest = await fetch(`${baseUrl}/api/config/models`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(model) });
    assert.equal(beforeTest.status, 422);

    const tested = await fetch(`${baseUrl}/api/config/models/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(model) });
    assert.equal(tested.status, 200);

    const saved = await fetch(`${baseUrl}/api/config/models`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(model) });
    assert.equal(saved.status, 201);
  });
  assert.equal(config.modelCatalog[0].id, 'custom-text');
});
