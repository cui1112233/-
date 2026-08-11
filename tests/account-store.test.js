const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAccountStore } = require('../lib/account-store');

function tempStore() {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-accounts-'));
  return createAccountStore({ systemDir });
}

function seed(store) {
  store.ensureSeedAccounts({
    choushiyiguai: '123456',
    choushiyiguai1: '123456'
  });
}

test('seeds the owner once and never grants owner to another account', () => {
  const store = tempStore();
  seed(store);

  assert.equal(store.getAccount('choushiyiguai').isOwner, true);
  assert.throws(() => store.setOwner('choushiyiguai1'), /owner is immutable/);
});

test('does not overwrite or append seed accounts after initial creation', () => {
  const store = tempStore();
  seed(store);

  store.ensureSeedAccounts({
    choushiyiguai: 'changed-password',
    choushiyiguai1: 'changed-password',
    lateraccount: '123456'
  });

  assert.equal(store.verifyPassword('choushiyiguai', '123456'), true);
  assert.equal(store.getAccount('lateraccount'), null);
});

test('keeps password hashes internal while verifying passwords securely', () => {
  const store = tempStore();
  seed(store);

  const account = store.getAccount('choushiyiguai');
  assert.equal(Object.hasOwn(account, 'passwordHash'), false);
  assert.equal(store.verifyPassword('choushiyiguai', '123456'), true);
  assert.equal(store.verifyPassword('choushiyiguai', 'wrong-password'), false);
});

test('grants scoped capability and writes a sanitized audit record', () => {
  const store = tempStore();
  seed(store);

  store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  });

  assert.equal(store.can('choushiyiguai1', 'preset:draft', 'novel-panel'), true);
  assert.equal(store.can('choushiyiguai1', 'preset:publish', 'novel-panel'), false);
  assert.equal(store.listAudit().at(-1).action, 'grant.created');
  assert.match(JSON.stringify(store.listAudit()), /grant\.created/);
  assert.doesNotMatch(JSON.stringify(store.listAudit()), /passwordHash/);
});

test('rejects invalid usernames, inactive subjects, duplicate grants, and non-owner actors', () => {
  const store = tempStore();
  seed(store);

  assert.equal(store.getAccount('../escape'), null);
  assert.throws(() => store.grant('choushiyiguai1', 'choushiyiguai', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  }), /owner/);

  store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  });
  assert.throws(() => store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  }), /already exists/);

  store.setActive('choushiyiguai1', false);
  assert.equal(store.can('choushiyiguai1', 'preset:draft', 'novel-panel'), false);
  assert.throws(() => store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:publish',
    scope: 'novel-panel'
  }), /active/);
});
