const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_ROUTES,
  normalizeSessionRequest,
  sanitizeSessionResponse
} = require('../services/121-browser-worker/src/contracts');

test('worker protocol exposes only bounded session routes', () => {
  assert.deepEqual(SESSION_ROUTES, {
    login: '/session/login',
    test: '/session/test',
    refresh: '/session/refresh',
    remove: '/session'
  });
});

test('login request requires owner target username and password', () => {
  const request = normalizeSessionRequest({
    owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin/', username: 'u', password: 'p'
  }, { requireCredentials: true });
  assert.equal(request.owner, 'alice');
  assert.equal(request.baseUrl, 'http://two.121w.com/tttadmin');
  assert.equal(request.username, 'u');
  assert.equal(request.password, 'p');
  assert.throws(() => normalizeSessionRequest({ owner: 'alice', baseUrl: 'javascript:bad', username: 'u', password: 'p' }, { requireCredentials: true }));
  assert.throws(() => normalizeSessionRequest({ owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin', username: 'u' }, { requireCredentials: true }));
});

test('session response strips credentials cookies and storage state', () => {
  const safe = sanitizeSessionResponse({
    ok: true, owner: 'alice', sessionKey: 'opaque', status: 'ready', password: 'secret', cookie: 'PHPSESSID=x',
    storageState: { cookies: [{ name: 'PHPSESSID', value: 'x' }] }, storage_state: { origins: [] }, detail: 'ok'
  });
  assert.deepEqual(safe, { ok: true, owner: 'alice', sessionKey: 'opaque', status: 'ready', detail: 'ok' });
  assert.equal(JSON.stringify(safe).includes('PHPSESSID'), false);
  assert.equal(JSON.stringify(safe).includes('secret'), false);
});
