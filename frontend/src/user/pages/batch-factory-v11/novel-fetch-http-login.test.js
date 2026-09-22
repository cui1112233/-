import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create121BrowserClient } = require('../../../../../lib/novel-fetch-workshop/121-browser-client.js');

test('121 login uses the JSON API and returns the merged HTTP cookie', async () => {
  const calls = [];
  const client = create121BrowserClient({
    httpClient: async request => {
      calls.push(request);
      if (request.method === 'GET') return { statusCode: 200, headers: { 'set-cookie': ['PHPSESSID=page; Path=/'] }, body: '登录页' };
      return { statusCode: 200, headers: { 'set-cookie': ['auth=logged-in; Path=/'] }, body: JSON.stringify({ success: true }) };
    }
  });

  const result = await client.login({ username: 'demo', password: 'secret' });

  assert.equal(result.status, 'ready');
  assert.equal(result.sessionKey, 'PHPSESSID=page; auth=logged-in');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://two.121w.com/tttadmin/login.php');
  assert.equal(calls[1].url, 'http://two.121w.com/tttadmin/api/login.php');
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].body.toString()), { username: 'demo', password: 'secret' });
});

test('121 session test sends the saved cookie to the target page', async () => {
  let request;
  const client = create121BrowserClient({
    httpClient: async value => { request = value; return { statusCode: 200, headers: {}, body: '自定义文案' }; }
  });

  const result = await client.test({ sessionKey: 'auth=logged-in' });

  assert.equal(result.ok, true);
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.Cookie, 'auth=logged-in');
  assert.equal(request.url, 'http://two.121w.com/tttadmin/zidingyi.php');
});
