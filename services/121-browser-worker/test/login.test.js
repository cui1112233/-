const test = require('node:test');
const assert = require('node:assert/strict');
const { performPageLogin } = require('../src/login');

function fakeBrowser({
  needsLogin = false,
  loginSucceeds = true,
  backendStatus = 200,
  backendBody = '<html><body>121 后台自定义文案</body></html>'
} = {}) {
  const calls = { goto: [], fills: [], clicks: [], storage: 0, backend: [] };
  let loginVisible = needsLogin;
  const locator = selector => ({
    count: async () => {
      if (/password/.test(selector)) return loginVisible ? 1 : 0;
      if (/user|name|account/.test(selector)) return loginVisible ? 1 : 0;
      if (/submit|登录|login/.test(selector)) return loginVisible ? 1 : 0;
      return 0;
    },
    fill: async value => { calls.fills.push([selector, value]); },
    click: async () => { calls.clicks.push(selector); if (loginSucceeds) loginVisible = false; }
  });
  const page = {
    goto: async url => { calls.goto.push(url); },
    locator,
    waitForLoadState: async () => {},
    waitForTimeout: async () => {}
  };
  const context = {
    newPage: async () => page,
    request: {
      fetch: async (url, options) => {
        calls.backend.push({ url, options });
        return {
          status: () => backendStatus,
          text: async () => backendBody
        };
      }
    },
    storageState: async () => { calls.storage += 1; return { cookies: [{ name: 'session', value: 'opaque' }], origins: [] }; },
    close: async () => {}
  };
  return { calls, browser: { newContext: async () => context } };
}

test('existing authenticated storage state is reused only after real backend verification', async () => {
  const { browser, calls } = fakeBrowser({ needsLogin: false });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } });
  assert.equal(calls.fills.length, 0);
  assert.equal(calls.clicks.length, 0);
  assert.equal(calls.backend.length, 1);
  assert.match(calls.backend[0].url, /^http:\/\/two\.121w\.com\/tttadmin\/zidingyi\.php$/);
  assert.equal(result.authenticated, true);
  assert.equal(calls.storage, 1);
});

test('login fills real page form then verifies backend before saving storage state', async () => {
  const { browser, calls } = fakeBrowser({ needsLogin: true, loginSucceeds: true });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin/', username: 'alice', password: 'secret' });
  assert.ok(calls.goto[0].endsWith('/booklist.php'));
  assert.ok(calls.fills.some(([, value]) => value === 'alice'));
  assert.ok(calls.fills.some(([, value]) => value === 'secret'));
  assert.equal(calls.clicks.length, 1);
  assert.equal(calls.backend.length, 1);
  assert.equal(result.authenticated, true);
});

test('missing password form alone is not enough to claim authenticated', async () => {
  const { browser } = fakeBrowser({ needsLogin: false, backendBody: '<html><body>管理员登录<input type="password"></body></html>' });
  await assert.rejects(
    performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } }),
    /后台身份验证失败/
  );
});

test('empty or failed backend page is not accepted as authenticated', async () => {
  const empty = fakeBrowser({ needsLogin: false, backendBody: '' });
  await assert.rejects(
    performPageLogin({ browser: empty.browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } }),
    /后台身份验证失败/
  );
  const failed = fakeBrowser({ needsLogin: false, backendStatus: 500, backendBody: 'server error' });
  await assert.rejects(
    performPageLogin({ browser: failed.browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } }),
    /后台身份验证失败/
  );
});

test('login fails closed when password form remains after submit', async () => {
  const { browser } = fakeBrowser({ needsLogin: true, loginSucceeds: false });
  await assert.rejects(
    performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'bad' }),
    /登录失败/
  );
});
