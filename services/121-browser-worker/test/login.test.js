const test = require('node:test');
const assert = require('node:assert/strict');
const { performPageLogin } = require('../src/login');

function fakeBrowser({ needsLogin = false, loginSucceeds = true, authenticatedMarker = true } = {}) {
  const calls = { goto: [], fills: [], clicks: [], storage: 0 };
  let loginVisible = needsLogin;
  let currentUrl = '';
  const locator = selector => ({
    count: async () => {
      if (/自定义文案|退出|注销|logout/i.test(selector)) return authenticatedMarker && !loginVisible ? 1 : 0;
      if (/password/.test(selector)) return loginVisible ? 1 : 0;
      if (/user|name|account/.test(selector)) return loginVisible ? 1 : 0;
      if (/submit|登录|login/.test(selector)) return loginVisible ? 1 : 0;
      return 0;
    },
    fill: async value => { calls.fills.push([selector, value]); },
    click: async () => { calls.clicks.push(selector); if (loginSucceeds) loginVisible = false; }
  });
  const page = {
    goto: async url => { currentUrl = url; calls.goto.push(url); },
    url: () => currentUrl,
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
  const { browser, calls } = fakeBrowser({ needsLogin: false, authenticatedMarker: true });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'p', storageState: { cookies: [] } });
  assert.equal(calls.fills.length, 0);
  assert.equal(calls.clicks.length, 0);
  assert.equal(result.authenticated, true);
  assert.equal(calls.storage, 1);
});

test('password form disappearing without authenticated backend marker is not success', async () => {
  const { browser } = fakeBrowser({ needsLogin: true, loginSucceeds: true, authenticatedMarker: false });
  await assert.rejects(
    performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'alice', password: 'secret' }),
    /后台身份标识|无法确认登录成功/
  );
});

test('login fills real page form and requires authenticated backend marker', async () => {
  const { browser, calls } = fakeBrowser({ needsLogin: true, loginSucceeds: true, authenticatedMarker: true });
  const result = await performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin/', username: 'alice', password: 'secret' });
  assert.ok(calls.goto[0].endsWith('/booklist.php'));
  assert.ok(calls.fills.some(([, value]) => value === 'alice'));
  assert.ok(calls.fills.some(([, value]) => value === 'secret'));
  assert.equal(calls.clicks.length, 1);
  assert.equal(result.authenticated, true);
});

test('login fails closed when password form remains after submit', async () => {
  const { browser } = fakeBrowser({ needsLogin: true, loginSucceeds: false, authenticatedMarker: false });
  await assert.rejects(
    performPageLogin({ browser, baseUrl: 'http://two.121w.com/tttadmin', username: 'u', password: 'bad' }),
    /登录失败/
  );
});
