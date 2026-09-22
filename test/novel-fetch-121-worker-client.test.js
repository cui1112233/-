const test = require('node:test');
const assert = require('node:assert/strict');

const { create121BrowserWorkerClient } = require('../lib/novel-fetch-workshop/121-browser-worker-client');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('121 worker client sends private login requests and returns only the safe session reference', async () => {
  const calls = [];
  const client = create121BrowserWorkerClient({
    baseUrl: 'http://worker:8787',
    secret: 'internal-secret',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ ok: true, status: 'ready', sessionKey: 'opaque' }); }
  });

  const result = await client.login({ owner: 'owner-1', baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p' });
  assert.deepEqual(result, { ok: true, status: 'ready', sessionKey: 'opaque' });
  assert.equal(calls[0].url, 'http://worker:8787/session/login');
  assert.equal(calls[0].options.headers['x-qiantie-internal-secret'], 'internal-secret');
  assert.equal(JSON.parse(calls[0].options.body).owner, 'owner-1');
});

test('121 worker client keeps worker authorization failures distinct from target session expiry', async () => {
  const client = create121BrowserWorkerClient({
    baseUrl: 'http://worker:8787',
    secret: 'internal-secret',
    fetchImpl: async () => response({ error: 'unauthorized' }, 401)
  });

  await assert.rejects(client.test({ owner: 'owner-1', baseUrl: 'http://two.121w.com/tttadmin', username: 'u' }), error => {
    assert.equal(error.code, 'BROWSER_WORKER_UNAUTHORIZED');
    assert.equal(error.status, 503);
    return true;
  });
});
