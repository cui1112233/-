const test = require('node:test');
const assert = require('node:assert/strict');
const { performAuthenticatedAction, buildActionRequest } = require('../src/actions');

function fakeBrowser({ body = '{"success":true}', status = 200, finalUrl = 'http://two.121w.com/tttadmin/api/zdy_config.php?action=list' } = {}) {
  const calls = [];
  const context = {
    request: {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          status: () => status,
          url: () => finalUrl,
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

test('authenticated action uses saved browser state and returns business response without cookies', async () => {
  const { browser, calls } = fakeBrowser();
  const result = await performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [{ name: 'old', value: 'hidden' }] }, action: 'config_list' });
  assert.deepEqual(calls[0].context.storageState.cookies[0].name, 'old');
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"success":true}');
  assert.ok(result.storageState);
});

test('authenticated action rejects redirect outside two.121w.com', async () => {
  const { browser } = fakeBrowser({ finalUrl: 'https://evil.example/capture' });
  await assert.rejects(
    performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'config_list' }),
    /two\.121w\.com|target host/i
  );
});

test('login page response is rejected as expired session', async () => {
  const { browser } = fakeBrowser({ body: '<html>管理员登录</html>', finalUrl: 'http://two.121w.com/tttadmin/login.php' });
  await assert.rejects(
    performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'dashboard' }),
    error => error.code === 'SESSION_EXPIRED'
  );
});

test('upload sends exact multipart bytes through authenticated context', async () => {
  const { browser, calls } = fakeBrowser({ finalUrl: 'http://two.121w.com/tttadmin/api/zbooklist_upload.php' });
  await performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'upload', payload: { contentType: 'multipart/form-data; boundary=abc', bodyBase64: Buffer.from('payload').toString('base64') } });
  const request = calls.find(item => item.url);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'multipart/form-data; boundary=abc');
  assert.equal(Buffer.from(request.options.data).toString(), 'payload');
});
