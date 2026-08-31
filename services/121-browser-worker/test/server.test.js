const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerApp } = require('../src/server');

async function listen(app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function request(base, path, { method = 'POST', secret = 'secret', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-qiantie-internal-secret': secret },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  return { status: response.status, data };
}

const identity = { owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin', username: 'u' };

test('worker rejects requests without internal secret', async () => {
  const app = createWorkerApp({ secret: 'secret', sessionStore: { load: () => null }, login: async () => ({ authenticated: true, storageState: {} }) });
  const { server, base } = await listen(app);
  try {
    const result = await request(base, '/session/test', { secret: 'wrong', body: identity });
    assert.equal(result.status, 401);
  } finally { server.close(); }
});

test('login persists storage state but never returns cookie or password', async () => {
  let saved;
  const app = createWorkerApp({
    secret: 'secret',
    sessionStore: { load: () => null, save: (_identity, state) => { saved = state; return { sessionKey: 'opaque' }; } },
    login: async () => ({ authenticated: true, storageState: { cookies: [{ name: 'PHPSESSID', value: 'x' }] } })
  });
  const { server, base } = await listen(app);
  try {
    const result = await request(base, '/session/login', { body: { ...identity, password: 'p' } });
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'ready');
    assert.deepEqual(saved.cookies[0].name, 'PHPSESSID');
    assert.equal(JSON.stringify(result.data).includes('PHPSESSID'), false);
    assert.equal(JSON.stringify(result.data).includes('"p"'), false);
  } finally { server.close(); }
});

test('visible test fails clearly when headed capability is unavailable', async () => {
  const app = createWorkerApp({ secret: 'secret', headedEnabled: false, sessionStore: { load: () => ({ cookies: [] }) }, login: async () => ({ authenticated: true, storageState: {} }) });
  const { server, base } = await listen(app);
  try {
    const result = await request(base, '/session/test', { body: { ...identity, headed: true } });
    assert.equal(result.status, 409);
    assert.equal(result.data.error, 'headed_browser_unavailable');
  } finally { server.close(); }
});

test('session test fails closed when no saved state exists', async () => {
  const app = createWorkerApp({ secret: 'secret', sessionStore: { load: () => null }, login: async () => ({ authenticated: true, storageState: {} }) });
  const { server, base } = await listen(app);
  try {
    const result = await request(base, '/session/test', { body: identity });
    assert.equal(result.status, 404);
    assert.equal(result.data.status, 'missing');
  } finally { server.close(); }
});
