const test = require('node:test');
const assert = require('node:assert/strict');
const { performAuthenticatedAction, buildActionRequest, createActionRunner } = require('../src/actions');

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
  assert.match(buildActionRequest(baseUrl, 'organization_list', {}).url, /\/tttadmin\/api\/organization\.php$/);
  assert.match(buildActionRequest(baseUrl, 'asset_presign', { bodyBase64: 'e30=' }).url, /\/tttadmin\/api\/music_put_url\.php$/);
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

test('asset presign sends its JSON only through the authenticated browser context', async () => {
  const { browser, calls } = fakeBrowser();
  await performAuthenticatedAction({ browser, baseUrl, storageState: { cookies: [] }, action: 'asset_presign', payload: { bodyBase64: Buffer.from('{"files":[]}').toString('base64') } });
  const request = calls.find(item => item.url);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.equal(Buffer.from(request.options.data).toString(), '{"files":[]}');
});

test('action runner reuses one browser and closes it after an expired session', async () => {
  let launches = 0;
  let closes = 0;
  const { browser } = fakeBrowser();
  const runner = createActionRunner({
    playwright: { chromium: { launch: async () => { launches += 1; return browser; } } },
    perform: async ({ browser: activeBrowser, fail }) => {
      assert.equal(activeBrowser, browser);
      if (fail) {
        const error = new Error('expired');
        error.code = 'SESSION_EXPIRED';
        throw error;
      }
      return { status: 200, storageState: { cookies: [] } };
    }
  });
  browser.close = async () => { closes += 1; };

  await runner({ baseUrl, storageState: { cookies: [] } });
  await runner({ baseUrl, storageState: { cookies: [] } });
  assert.equal(launches, 1);
  await assert.rejects(runner({ baseUrl, storageState: { cookies: [] }, fail: true }), error => error.code === 'SESSION_EXPIRED');
  assert.equal(closes, 1);
  await runner.close();
});

test('action runner releases an idle browser after its bounded lifetime', async () => {
  let closes = 0;
  const { browser } = fakeBrowser();
  browser.close = async () => { closes += 1; };
  const runner = createActionRunner({
    idleMs: 5,
    playwright: { chromium: { launch: async () => browser } },
    perform: async () => ({ status: 200, storageState: { cookies: [] } })
  });
  await runner({ baseUrl, storageState: { cookies: [] } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closes, 1);
});

test('queued idle close does not terminate a newly active authenticated action', async () => {
  let closes = 0;
  let idleClose;
  let releaseAction;
  const { browser } = fakeBrowser();
  browser.close = async () => { closes += 1; };
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = callback => { idleClose = callback; return 1; };
  global.clearTimeout = () => {};
  try {
    const runner = createActionRunner({
      idleMs: 5,
      playwright: { chromium: { launch: async () => browser } },
      perform: async ({ hold }) => {
        if (hold) await new Promise(resolve => { releaseAction = resolve; });
        return { status: 200, storageState: { cookies: [] } };
      }
    });

    await runner({ baseUrl, storageState: { cookies: [] } });
    const inFlight = runner({ baseUrl, storageState: { cookies: [] }, hold: true });
    await new Promise(resolve => setImmediate(resolve));
    idleClose();
    await Promise.resolve();

    assert.equal(closes, 0);
    releaseAction();
    await inFlight;
    await runner.close();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
