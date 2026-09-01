const test = require('node:test');
const assert = require('node:assert/strict');
const { performAuthenticatedAction, buildActionRequest } = require('../src/actions');

function fakeBrowser({ body = '{"success":true}', status = 200 } = {}) {
  const calls = [];
  const context = {
    request: {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          status: () => status,
          text: async () => body,
          headers: () => ({ 'content-type': 'application/json' })
        };
      }
    },
    storageState: async () => ({ cookies: [{ name: 'session', value: 'opaque' }], origins: [] }),
    close: async () => {}
  };
  return { calls, browser: { newContext: async options => { calls.push({ context: options }); return context; } } };
}

const baseUrl = 'http://two.121w.com/tttadmin';

test('action builder only allows known 121 endpoints', () => {
  assert.match(buildActionRequest(baseUrl, 'dashboard', {}).url, /\/tttadmin\/zidingyi\.php$/);
  assert.match(buildActionRequest(baseUrl, 'config_list', {}).url, /\/tttadmin\/api\/zdy_config\.php\?action=list$/);
  assert.match(buildActionRequest(baseUrl, 'book_list', { bookId: '123' }).url, /zbooklist_get\.php\?.*bookid=123/);
  assert.match(buildActionRequest(baseUrl, 'upload', { contentType: 'multipart\/form-data; boundary=x', bodyBase64: 'YWJj' }).url, /zbooklist_upload\.php$/);
  assert.throws(() => buildActionRequest(baseUrl, 'http://evil.example/', {}), /unsupported 121 action/);
});

test('action builder rejects a non-121 base URL even for a supported action', () => {
  assert.throws(
    () => buildActionRequest('http://example.com/tttadmin', 'dashboard', {}),
    /invalid 121 target/
  );
});

test('authenticated action uses saved browser state and returns business response without cookies', async () => {
  const { browser, calls } = fakeBrowser();
  const result = await performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [{ name: 'old', value: 'hidden' }] }, action: 'config_list' });
  assert.deepEqual(calls[0].context.storageState.cookies[0].name, 'old');
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"success":true}');
  assert.ok(result.storageState);
});

test('login page response is rejected as expired session', async () => {
  const { browser } = fakeBrowser({ body: '<html>管理员登录</html>' });
  await assert.rejects(
    performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'dashboard' }),
    error => error.code === 'SESSION_EXPIRED'
  );
});

test('upload sends exact multipart bytes through authenticated context', async () => {
  const { browser, calls } = fakeBrowser();
  await performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'upload', payload: { contentType: 'multipart/form-data; boundary=abc', bodyBase64: Buffer.from('payload').toString('base64') } });
  const request = calls.find(item => item.url);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'multipart/form-data; boundary=abc');
  assert.equal(Buffer.from(request.options.data).toString(), 'payload');
});
