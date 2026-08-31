const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchStore } = require('../lib/novel-fetch-store');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-browser-session-')); }

test('novel fetch store persists browser worker session reference without cookie material', () => {
  const usersDir = tempUsersDir();
  const store = createNovelFetchStore({ usersDir });
  store.setBrowserSession('alice', { sessionKey: 'opaque-key', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' });
  const saved = store.getBrowserSession('alice');
  assert.equal(saved.mode, 'browser_worker');
  assert.equal(saved.sessionKey, 'opaque-key');
  assert.equal(saved.targetUsername, 'site-user');
  assert.equal(saved.cookie, undefined);
  const raw = fs.readFileSync(path.join(usersDir, 'alice', 'upload-target.json'), 'utf8');
  assert.equal(raw.includes('PHPSESSID'), false);
  assert.equal(raw.includes('cookie'), false);
});

test('legacy cookie session remains readable for rollback compatibility but is not a browser session', () => {
  const usersDir = tempUsersDir();
  const store = createNovelFetchStore({ usersDir });
  store.setSession('alice', 'PHPSESSID=legacy');
  assert.equal(store.getSession('alice').cookie, 'PHPSESSID=legacy');
  assert.equal(store.getBrowserSession('alice'), null);
});
