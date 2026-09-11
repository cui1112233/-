const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const { createConfigRouter } = require('../routes/config');

test('an authenticated account absent from memberStore cannot create catalog models', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRouter({
    memberStore: { getMember: () => null },
    configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [] }),
    configWriter: () => {},
    isModelReferenced: () => false,
    authenticate: (req, _res, next) => {
      req.username = 'orphan';
      req.auth = { account: { username: 'orphan', active: true } };
      next();
    }
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'text-gpt54', kind: 'text', modelId: 'gpt-5.4', credential: 'orphan-secret', enabled: true })
    });

    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /仅管理者可以管理模型/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
