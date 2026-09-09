const test = require('node:test');
const assert = require('node:assert/strict');
const { create121BrowserClient } = require('../lib/novel-fetch-workshop/121-browser-client');

const identity = { owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin', username: 'site-user' };

test('browser client fails closed when worker is not configured', async () => {
  const client = create121BrowserClient({ baseUrl: '', secret: '' });
  await assert.rejects(client.test(identity), error => {
    assert.equal(error.code, 'BROWSER_WORKER_UNAVAILABLE');
    assert.equal(error.recoverable, false);
    assert.match(error.message, /浏览器登录服务不可用/);
    return true;
  });
});

test('browser client sends only internal worker request with secret', async () => {
  const calls = [];
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret: 'internal-secret', timeoutMs: 15000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'ready', sessionKey: 'opaque' }) };
    }
  });
  const result = await client.login({ ...identity, password: 'pw' });
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://worker:8787/session/login');
  assert.equal(calls[0].options.headers['x-qiantie-internal-secret'], 'internal-secret');
  assert.equal(JSON.parse(calls[0].options.body).password, 'pw');
});

test('browser client preserves worker secret exactly on the wire', async () => {
  const calls = [];
  const secret = '  internal-secret-with-padding  ';
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'ready' }) };
    }
  });

  await client.test(identity);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['x-qiantie-internal-secret'], secret);
});

test('browser login gets a longer wall-clock budget than normal worker calls', async () => {
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787',
    secret: 'internal-secret',
    timeoutMs: 20,
    loginTimeoutMs: 2500,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, status: 'ready', sessionKey: 'opaque' })
      }), 1250);
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    })
  });

  const result = await client.login({ ...identity, password: 'pw' });
  assert.equal(result.status, 'ready');
});

test('browser client authenticated action stays inside worker contract', async () => {
  const calls = [];
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret: 'internal-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'ready', targetStatus: 200, body: '{"success":true}' }) };
    }
  });
  const result = await client.action({ ...identity, action: 'config_list', payload: {} });
  assert.equal(result.targetStatus, 200);
  assert.equal(calls[0].url, 'http://worker:8787/session/action');
  assert.equal(JSON.parse(calls[0].options.body).action, 'config_list');
});

test('worker failure never falls back to guessed 121 login API', async () => {
  const urls = [];
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret: 'internal-secret',
    fetchImpl: async url => {
      urls.push(url);
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'worker_down' }) };
    }
  });
  await assert.rejects(client.refresh({ ...identity, password: 'pw' }), /浏览器登录服务/);
  assert.deepEqual(urls, ['http://worker:8787/session/refresh']);
  assert.equal(urls.some(url => url.includes('tttadmin/api/login.php')), false);
});

test('browser client wall-clock timeout settles request', async () => {
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret: 'internal-secret', timeoutMs: 20,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  await assert.rejects(client.test(identity), error => {
    assert.equal(error.code, 'BROWSER_WORKER_TIMEOUT');
    return true;
  });
});

test('browser client gives login requests a longer deadline than session checks', async () => {
  const client = create121BrowserClient({
    baseUrl: 'http://worker:8787', secret: 'internal-secret', timeoutMs: 1000, loginTimeoutMs: 1100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  });
  const startedAt = Date.now();
  const settled = {};
  await Promise.all([
    client.test(identity).catch(error => { settled.test = { elapsed: Date.now() - startedAt, error }; }),
    client.login({ ...identity, password: 'pw' }).catch(error => { settled.login = { elapsed: Date.now() - startedAt, error }; })
  ]);
  assert.equal(settled.test.error.code, 'BROWSER_WORKER_TIMEOUT');
  assert.equal(settled.login.error.code, 'BROWSER_WORKER_TIMEOUT');
  assert.ok(settled.login.elapsed >= settled.test.elapsed + 50, JSON.stringify(settled));
});
