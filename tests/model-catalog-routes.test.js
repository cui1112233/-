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

function makeApp({ referenced = () => false } = {}) {
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
    return { status: response.status, body: await response.json() };
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
