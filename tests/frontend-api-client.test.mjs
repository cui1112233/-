import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
const { apiRequest } = await import('../frontend/src/shared/api/client.js');
const authSource = await readFile(new URL('../frontend/src/shared/api/auth.js', import.meta.url), 'utf8');

function installBrowserGlobals(response) {
  globalThis.localStorage = {
    getItem: () => '',
    setItem: () => {},
    removeItem: () => {}
  };
  globalThis.fetch = async () => response;
}

test.after(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

test('apiRequest shows a backend Chinese error field instead of raw JSON', async () => {
  installBrowserGlobals(new Response(JSON.stringify({ error: '请先确认分段' }), {
    status: 409,
    headers: { 'content-type': 'application/json' }
  }));

  await assert.rejects(apiRequest('/api/example'), error => {
    assert.equal(error.message, '请先确认分段');
    assert.equal(error.status, 409);
    assert.equal(error.responseText, '{"error":"请先确认分段"}');
    return true;
  });
});

test('apiRequest keeps non-JSON error text readable', async () => {
  installBrowserGlobals(new Response('上游服务暂时不可用', { status: 503 }));

  await assert.rejects(apiRequest('/api/example'), error => {
    assert.equal(error.message, '上游服务暂时不可用');
    assert.equal(error.status, 503);
    assert.equal(error.responseText, '上游服务暂时不可用');
    return true;
  });
});

test('account lookup uses the authenticated session endpoint', async () => {
  assert.match(authSource, /export function getCurrentAccount\(\)\s*\{\s*return apiRequest\('\/api\/login\/session'\);\s*\}/);
  assert.doesNotMatch(authSource, /apiRequest\('\/api\/me'\)/);
});
