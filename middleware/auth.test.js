const assert = require('node:assert/strict');
const test = require('node:test');

const { authenticateMiniProgramRequest } = require('./auth');

test('mini-program token is resolved by Go and then checked against the local active account', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://go-api:4000/api/wechat-miniprogram/session');
    assert.equal(options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
    return new Response(JSON.stringify({ account: { username: 'ming', isOwner: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const account = { username: 'ming', active: true, pending: false, isOwner: true };
    const auth = await authenticateMiniProgramRequest({
      headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      app: { locals: { authRuntime: { accountStore: {
        getAccount: username => username === 'ming' ? account : null,
        effectivePermissions: value => value.isOwner ? ['*'] : []
      } } } }
    });
    assert.equal(auth.username, 'ming');
    assert.equal(auth.account, account);
  } finally {
    global.fetch = originalFetch;
  }
});

test('mini-program token cannot reactivate a locally disabled account', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ account: { username: 'disabled-user' } }), { status: 200 });
  try {
    const auth = await authenticateMiniProgramRequest({
      headers: { authorization: `Bearer ${'b'.repeat(64)}` },
      app: { locals: { authRuntime: { accountStore: {
        getAccount: () => ({ username: 'disabled-user', active: false, pending: false }),
        effectivePermissions: () => []
      } } } }
    });
    assert.equal(auth, null);
  } finally {
    global.fetch = originalFetch;
  }
});
