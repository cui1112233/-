const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchStore } = require('./novel-fetch-store');

test('direct and workshop 121 logins share one compatible persistent session', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-121-session-'));
  const store = createNovelFetchStore({ usersDir });
  store.setSession('alice', 'PHPSESSID=legacy', { targetUsername: '账号A', baseUrl: 'http://two.121w.com/tttadmin' });
  assert.equal(store.getSession('alice').cookie, 'PHPSESSID=legacy');
  assert.equal(store.getBrowserSession('alice').sessionKey, 'PHPSESSID=legacy');

  store.setBrowserSession('alice', {
    sessionKey: 'PHPSESSID=renewed', targetUsername: '账号A', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready'
  });
  assert.equal(store.getSession('alice').cookie, 'PHPSESSID=renewed');
  assert.equal(store.getBrowserSession('alice').sessionKey, 'PHPSESSID=renewed');
});
