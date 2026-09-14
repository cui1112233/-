const test = require('node:test');
const assert = require('node:assert/strict');
const { performPageLogin, loginWithPlaywright } = require('../src/login');

function fakeBrowser({ needsLogin = false, loginSucceeds = true } = {}) {
  const calls = { goto: [], fills: [], clicks: [], storage: 0 };
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
    storageState: async () => { calls.storage += 1; return { cookies: [{ name: 'session', value: 'opaque' }], origins: [] }; },
    close: async () => {}
  };
  return { calls, browser: { newContext: async () => context } };
}

test('existing authenticated storage state is reused without credential submission', async () => {
  const { browser, calls } = fakeBrowser({ needsLogin: false });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } });
  assert.equal(calls.fills.length, 0);
  assert.equal(calls.clicks.length, 0);
  assert.equal(result.authenticated, true);
  assert.equal(calls.storage, 1);
});

test('valid stored session is verified directly without launching a browser', async () => {
  let browserContexts = 0;
  const result = await performPageLogin({
    browser: { newContext: async () => { browserContexts += 1; throw new Error('browser should not launch'); } },
    baseUrl: 'http://two.121w.com/tttadmin',
    storageState: { cookies: [{ name: 'PHPSESSID', value: 'opaque', domain: 'two.121w.com', path: '/' }] },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.cookie, 'PHPSESSID=opaque');
      return { status: 200, ok: true, text: async () => '<html><body>admin index</body></html>' };
    }
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.reusedSession, true);
  assert.equal(browserContexts, 0);
});

test('playwright login does not launch Chromium when stored session is valid', async () => {
  let launches = 0;
  const result = await loginWithPlaywright({
    baseUrl: 'http://two.121w.com/tttadmin',
    storageState: { cookies: [{ name: 'PHPSESSID', value: 'opaque', domain: 'two.121w.com', path: '/' }] },
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => '<html>admin index</html>' }),
    playwright: { chromium: { launch: async () => { launches += 1; throw new Error('Chromium should not launch'); } } }
  });
  assert.equal(result.reusedSession, true);
  assert.equal(launches, 0);
});

test('first login uses the target JSON endpoint without launching Chromium', async () => {
  let launches = 0;
  const result = await loginWithPlaywright({
    baseUrl: 'http://two.121w.com/tttadmin',
    username: 'alice',
    password: 'secret',
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { username: 'alice', password: 'secret' });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        headers: { getSetCookie: () => ['PHPSESSID=opaque; Path=/; HttpOnly'] }
      };
    },
    playwright: { chromium: { launch: async () => { launches += 1; throw new Error('Chromium should not launch'); } } }
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.reusedSession, false);
  assert.equal(result.storageState.cookies[0].name, 'PHPSESSID');
  assert.equal(launches, 0);
});

test('login fills real page form and saves new storage state', async () => {
  const { browser, calls } = fakeBrowser({ needsLogin: true, loginSucceeds: true });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin/', username: 'alice', password: 'secret' });
  assert.ok(calls.goto[0].endsWith('/booklist.php'));
  assert.ok(calls.fills.some(([, value]) => value === 'alice'));
  assert.ok(calls.fills.some(([, value]) => value === 'secret'));
  assert.equal(calls.clicks.length, 1);
  assert.equal(result.authenticated, true);
});

test('login fails closed when password form remains after submit', async () => {
  const { browser } = fakeBrowser({ needsLogin: true, loginSucceeds: false });
  await assert.rejects(
    performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'bad' }),
    /登录失败/
  );
});
