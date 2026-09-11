const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const { createConfigRouter } = require('../routes/config');

function memberStoreFor(members, scopes = {}) {
  return {
    getMember(username) {
      return members[username] || null;
    },
    canUseApi(username, scope) {
      return (scopes[username] || []).includes('*') || (scopes[username] || []).includes(scope);
    }
  };
}

function makeApp({ referenced = () => false, executorPairingStatus = async () => false } = {}) {
  const configs = new Map([['manager', { modelCatalogVersion: 1, modelCatalog: [] }]]);
  const accounts = {
    manager: { username: 'manager', active: true },
    member: { username: 'member', active: true }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRouter({
    memberStore: memberStoreFor({
      manager: { ...accounts.manager, role: 'manager' },
      member: { ...accounts.member, role: 'member', boundTo: 'manager' }
    }, { member: ['video'] }),
    configReader: username => configs.get(username) || { modelCatalogVersion: 1, modelCatalog: [] },
    configWriter: (username, config) => configs.set(username, config),
    isModelReferenced: ({ modelId }) => referenced(modelId),
    getExecutorPairingStatus: executorPairingStatus,
    authenticate: (req, _res, next) => {
      req.username = req.headers['x-test-user'];
      req.auth = { account: accounts[req.username] };
      next();
    }
  }));
  return app;
}

async function request(app, { method = 'GET', path, token, body } = {}) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        'X-Test-User': token === 'manager-token' ? 'manager' : 'member',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('manager CRUD saves enabled catalog models and members only read the allowed kind', async () => {
  const app = makeApp();
  const created = await request(app, {
    method: 'POST',
    path: '/api/config/models',
    token: 'manager-token',
    body: { id: 'minimax-h3-video', displayName: 'H3', credential: 'manager-secret', enabled: true }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.model.id, 'minimax-h3-video');
  assert.equal(JSON.stringify(created.body).includes('manager-secret'), false);

  const updated = await request(app, {
    method: 'PATCH',
    path: '/api/config/models/minimax-h3-video',
    token: 'manager-token',
    body: { displayName: 'H3 视频' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.model.displayName, 'H3 视频');

  const visible = await request(app, { path: '/api/config/models?kind=video', token: 'member-token' });
  assert.equal(visible.status, 200);
  assert.deepEqual(visible.body.models.map(model => model.id), ['minimax-h3-video']);
  assert.equal(JSON.stringify(visible.body).includes('manager-secret'), false);

  const forbidden = await request(app, {
    method: 'POST',
    path: '/api/config/models',
    token: 'member-token',
    body: { id: 'text-gpt54', kind: 'text', credential: 'member-secret', enabled: true }
  });
  assert.equal(forbidden.status, 403);
});

test('custom create derives a stable catalog id and persists whitelisted capabilities', async () => {
  const app = makeApp();
  const created = await request(app, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      kind: 'text', displayName: 'GPT 5.4', providerType: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1', modelId: 'gpt-5.4', credential: 'secret', enabled: true,
      capabilities: { supportsReferenceImages: true, requiresImageInput: false, maxVideoDuration: 12 }
    }
  });

  assert.equal(created.status, 201);
  assert.match(created.body.model.id, /^custom-gpt-5-4/);
  assert.deepEqual(created.body.model.capabilities, {
    supportsReferenceImages: true, requiresImageInput: false, maxVideoDuration: 12
  });

  const reloaded = await request(app, { path: '/api/config/models?kind=text', token: 'manager-token' });
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.body.models[0].capabilities, created.body.model.capabilities);

  const duplicate = await request(app, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      kind: 'text', displayName: 'GPT 5.4 copy', providerType: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1', modelId: 'gpt-5.4', credential: 'secret-2', enabled: true
    }
  });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.model.id, 'custom-gpt-5-4-2');
});

test('custom model cannot be saved enabled without endpoint model id and API key', async () => {
  const app = makeApp();
  const rejected = await request(app, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      kind: 'text', displayName: 'Missing key', providerType: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1', modelId: 'missing-key', enabled: true
    }
  });

  assert.equal(rejected.status, 422);
  assert.match(rejected.body.error, /API Key/);
});

test('manager keeps disabled custom models in its catalog for later editing and enabling', async () => {
  const app = makeApp();
  const created = await request(app, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      kind: 'image', displayName: '暂存图片模型', providerType: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1', modelId: 'image-draft', credential: 'secret', enabled: false
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.model.enabled, false);

  const reloaded = await request(app, { path: '/api/config/models?kind=image', token: 'manager-token' });
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.body.models.map(model => model.id), [created.body.model.id]);
  assert.equal(reloaded.body.models[0].enabled, false);
});

test('server rejects an enabled H3 preset without an API key', async () => {
  const app = makeApp();
  const rejected = await request(app, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      id: 'minimax-h3-video', enabled: true
    }
  });

  assert.equal(rejected.status, 422);
  assert.match(rejected.body.error, /API Key/);
});

test('local Doubao preset persists only pairing observed by the server', async () => {
  const unpaired = makeApp({ executorPairingStatus: async () => false });
  const rejected = await request(unpaired, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      id: 'local-doubao-executor-video', enabled: true, executorPaired: true
    }
  });
  assert.equal(rejected.status, 422);
  assert.match(rejected.body.error, /执行器配对/);

  const paired = makeApp({ executorPairingStatus: async () => true });
  const created = await request(paired, {
    method: 'POST', path: '/api/config/models', token: 'manager-token', body: {
      id: 'local-doubao-executor-video', enabled: true, executorPaired: false
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.model.executorPaired, true);
  assert.equal(created.body.model.enabled, true);

  const persisted = await request(paired, {
    path: '/api/config/models/local-doubao-executor-video/pairing-status', token: 'manager-token'
  });
  assert.equal(persisted.status, 200);
  assert.equal(persisted.body.executorPaired, true);
});

test('manager cannot delete a catalog model referenced by a pending setting or task', async () => {
  const app = makeApp({ referenced: modelId => modelId === 'minimax-h3-video' });
  await request(app, {
    method: 'POST',
    path: '/api/config/models',
    token: 'manager-token',
    body: { id: 'minimax-h3-video', credential: 'manager-secret', enabled: true }
  });

  const deleted = await request(app, {
    method: 'DELETE',
    path: '/api/config/models/minimax-h3-video',
    token: 'manager-token'
  });

  assert.equal(deleted.status, 409);
  assert.match(deleted.body.error, /仍被默认设置或待执行任务引用/);
});

test('manager cannot delete a model referenced by persisted manager defaults', async () => {
  const configs = new Map([['manager', {
    modelCatalogVersion: 1,
    modelCatalog: [{ id: 'minimax-h3-video', credential: 'manager-secret', enabled: true }],
    defaults: { videoModelId: 'minimax-h3-video' }
  }]]);
  const accounts = {
    manager: { username: 'manager', active: true },
    member: { username: 'member', active: true }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRouter({
    memberStore: memberStoreFor({
      manager: { ...accounts.manager, role: 'manager' },
      member: { ...accounts.member, role: 'member', boundTo: 'manager' }
    }, { member: ['video'] }),
    configReader: username => configs.get(username) || {},
    configWriter: (username, config) => configs.set(username, config),
    authenticate: (req, _res, next) => {
      req.username = req.headers['x-test-user'];
      req.auth = { account: accounts[req.username] };
      next();
    }
  }));

  const deleted = await request(app, {
    method: 'DELETE', path: '/api/config/models/minimax-h3-video', token: 'manager-token'
  });

  assert.equal(deleted.status, 409);
  assert.match(deleted.body.error, /仍被默认设置或待执行任务引用/);
});
