const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const { createConfigRouter } = require('../routes/config');

function createTestApp(configs, referenceSources = {}) {
  const accounts = { manager: { username: 'manager', active: true } };
  const app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRouter({
    memberStore: { getMember: () => ({ role: 'manager', active: true }) },
    configReader: username => configs.get(username) || {},
    configWriter: (username, config) => configs.set(username, config),
    ...referenceSources,
    authenticate: (req, _res, next) => {
      req.username = 'manager';
      req.auth = { account: accounts.manager };
      next();
    }
  }));
  return app;
}

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'DELETE' });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('DELETE refuses a model referenced by persisted manager model defaults', async () => {
  const configs = new Map([['manager', {
    modelCatalogVersion: 1,
    modelCatalog: [{ id: 'custom-gpt', kind: 'text', modelId: 'gpt-5.4', credential: 'key', enabled: true }],
    defaults: { textModelId: 'custom-gpt' }
  }]]);

  const result = await request(createTestApp(configs), '/api/config/models/custom-gpt');

  assert.equal(result.status, 409);
  assert.match(result.body.error, /仍被默认设置或待执行任务引用/);
  assert.equal(configs.get('manager').modelCatalog.length, 1);
});

test('DELETE fails closed when the batch persistent source is unavailable', async () => {
  const configs = new Map([['manager', {
    modelCatalogVersion: 1,
    modelCatalog: [{ id: 'custom-gpt', kind: 'text', modelId: 'gpt-5.4', credential: 'key', enabled: true }],
    defaults: { textModelId: 'another-model' }
  }]]);

  const result = await request(createTestApp(configs), '/api/config/models/custom-gpt');

  assert.equal(result.status, 409);
  assert.equal(configs.get('manager').modelCatalog.length, 1);
});

test('DELETE removes a persisted model with no reference when all persistent sources are available', async () => {
  const configs = new Map([['manager', {
    modelCatalogVersion: 1,
    modelCatalog: [{ id: 'custom-gpt', kind: 'text', modelId: 'gpt-5.4', credential: 'key', enabled: true }],
    defaults: { textModelId: 'another-model' }
  }]]);
  const referenceSources = {
    accountReader: username => username === 'manager' ? { username: 'manager' } : null,
    batchFactoryStoreFactory: {
      forAccount: () => ({ listBatches: async () => [] })
    }
  };

  const result = await request(createTestApp(configs, referenceSources), '/api/config/models/custom-gpt');

  assert.equal(result.status, 204);
  assert.deepEqual(configs.get('manager').modelCatalog, []);
});
