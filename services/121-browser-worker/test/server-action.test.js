const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerApp } = require('../src/server');

async function listen(app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function post(base, body, owner = 'alice') {
  const response = await fetch(`${base}/session/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qiantie-internal-secret': 'secret',
      'x-qiantie-owner': owner
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

const identity = { baseUrl: 'http://two.121w.com/tttadmin', username: 'u' };

test('session action uses saved state, persists refreshed state and hides storage material', async () => {
  let saved;
  const app = createWorkerApp({
    secret: 'secret',
    sessionStore: { load: input => { assert.equal(input.owner, 'alice'); return { cookies: [{ name: 'old', value: 'hidden' }] }; }, save: (_identity, state) => { saved = state; return { sessionKey: 'opaque' }; } },
    action: async options => {
      assert.equal(options.owner, 'alice');
      assert.equal(options.action, 'config_list');
      assert.equal(options.storageState.cookies[0].name, 'old');
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true}', storageState: { cookies: [{ name: 'new', value: 'hidden2' }] } };
    }
  });
  const { server, base } = await listen(app);
  try {
    const result = await post(base, { ...identity, action: 'config_list', payload: {} });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.targetStatus, 200);
    assert.equal(result.data.body, '{"success":true}');
    assert.equal(JSON.stringify(result.data).includes('hidden2'), false);
    assert.equal(saved.cookies[0].name, 'new');
  } finally { server.close(); }
});

test('session action fails closed when state is missing or expired', async () => {
  const missingApp = createWorkerApp({ secret: 'secret', sessionStore: { load: () => null }, action: async () => ({}) });
  let running = await listen(missingApp);
  try { assert.equal((await post(running.base, { ...identity, action: 'dashboard' })).status, 404); }
  finally { running.server.close(); }

  const expiredApp = createWorkerApp({
    secret: 'secret',
    sessionStore: { load: () => ({ cookies: [] }), save: () => ({ sessionKey: 'k' }) },
    action: async () => { const error = new Error('expired'); error.code = 'SESSION_EXPIRED'; throw error; }
  });
  running = await listen(expiredApp);
  try {
    const result = await post(running.base, { ...identity, action: 'dashboard' });
    assert.equal(result.status, 401);
    assert.equal(result.data.error, 'session_expired');
  } finally { running.server.close(); }
});
