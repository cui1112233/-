const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create121CredentialStore } = require('../lib/novel-fetch-workshop/121-credential-store');

test('121 credentials are owner scoped and encrypted at rest', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-121-creds-'));
  const store = create121CredentialStore({ usersDir, secret: 'test-secret' });
  store.set('alice', { targetUsername: 'site-user', password: 'plain-secret', baseUrl: 'http://two.121w.com/tttadmin' });
  assert.equal(store.get('alice').password, 'plain-secret');
  assert.equal(store.get('bob'), null);
  const raw = fs.readFileSync(path.join(usersDir, 'alice', 'novel-fetch-workshop', '121-credentials.json'), 'utf8');
  assert.equal(raw.includes('plain-secret'), false);
  assert.equal(raw.includes('site-user'), false);
});

test('121 credential store fails closed with the wrong secret and supports clear', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-121-creds-'));
  create121CredentialStore({ usersDir, secret: 'secret-a' }).set('alice', { targetUsername: 'u', password: 'p', baseUrl: 'http://two.121w.com/tttadmin' });
  assert.equal(create121CredentialStore({ usersDir, secret: 'secret-b' }).get('alice'), null);
  const store = create121CredentialStore({ usersDir, secret: 'secret-a' });
  assert.equal(store.clear('alice'), true);
  assert.equal(store.get('alice'), null);
});
