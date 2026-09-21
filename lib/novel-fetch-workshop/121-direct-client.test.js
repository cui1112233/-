const assert = require('node:assert/strict');
const test = require('node:test');

const { create121DirectClient } = require('./121-direct-client');

test('direct login establishes, merges, and verifies the 121 PHP session', async () => {
  const calls = [];
  const client = create121DirectClient({
    requestHttp: async request => {
      calls.push(request);
      if (calls.length === 1) {
        return { status: 200, headers: { 'set-cookie': ['PHPSESSID=initial; Path=/'] }, body: '<form>管理员登录</form>' };
      }
      if (calls.length === 2) {
        return { status: 200, headers: { 'set-cookie': ['PHPSESSID=ready; Path=/', 'admin=yes; Path=/'] }, body: '{"success":true}' };
      }
      return { status: 200, headers: {}, body: '<h1>自定义文案</h1>' };
    }
  });

  const result = await client.login({ username: 'alice', password: 'secret' });

  assert.equal(result.cookie, 'PHPSESSID=ready; admin=yes');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.endsWith('/tttadmin/login.php'), true);
  assert.equal(calls[1].url.endsWith('/tttadmin/api/login.php'), true);
  assert.equal(calls[1].headers.Cookie, 'PHPSESSID=initial');
  assert.equal(calls[2].headers.Cookie, 'PHPSESSID=ready; admin=yes');
  assert.equal(calls[2].url.endsWith('/tttadmin/zidingyi.php'), true);
});

test('direct action fails closed when the 121 response returns the login page', async () => {
  const client = create121DirectClient({
    requestHttp: async () => ({ status: 200, headers: {}, body: '<h1>管理员登录</h1>' })
  });

  await assert.rejects(
    client.action({ cookie: 'PHPSESSID=expired', path: '/tttadmin/api/zdy_config.php?action=list' }),
    error => error && error.code === 'SESSION_EXPIRED'
  );
});

test('direct actions surface upstream HTTP failures instead of treating them as completed', async () => {
  const client = create121DirectClient({
    requestHttp: async () => ({ status: 502, headers: {}, body: '<html>bad gateway</html>' })
  });
  await assert.rejects(
    client.action({ cookie: 'PHPSESSID=ready', path: '/tttadmin/api/zdy_config.php?action=list' }),
    error => error && error.code === 'TARGET_HTTP_ERROR' && error.status === 502
  );
});
