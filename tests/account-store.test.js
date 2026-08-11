const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAccountStore } = require('../lib/account-store');

function tempStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-accounts-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return { store: createAccountStore({ systemDir }), systemDir };
}

function seed(store) {
  store.ensureSeedAccounts({
    choushiyiguai: '123456',
    choushiyiguai1: '123456'
  });
}

test('seeds the owner once and never grants owner to another account', t => {
  const { store } = tempStore(t);
  seed(store);

  assert.equal(store.getAccount('choushiyiguai').isOwner, true);
  assert.throws(() => store.setOwner('choushiyiguai1'), /owner is immutable/);
});

test('does not overwrite or append seed accounts after initial creation', t => {
  const { store } = tempStore(t);
  seed(store);

  store.ensureSeedAccounts({
    choushiyiguai: 'changed-password',
    choushiyiguai1: 'changed-password',
    lateraccount: '123456'
  });

  assert.equal(store.verifyPassword('choushiyiguai', '123456'), true);
  assert.equal(store.getAccount('lateraccount'), null);
});

test('keeps password hashes internal while verifying passwords securely', t => {
  const { store } = tempStore(t);
  seed(store);

  const account = store.getAccount('choushiyiguai');
  assert.equal(Object.hasOwn(account, 'passwordHash'), false);
  assert.equal(store.verifyPassword('choushiyiguai', '123456'), true);
  assert.equal(store.verifyPassword('choushiyiguai', 'wrong-password'), false);
});

test('grants scoped capability and writes a sanitized audit record', t => {
  const { store } = tempStore(t);
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

test('rejects invalid usernames, inactive subjects, duplicate grants, and non-owner actors', t => {
  const { store } = tempStore(t);
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

test('preserves corrupt grant and audit files instead of treating them as empty', t => {
  for (const fileName of ['grants.json', 'audit.json']) {
    const { store, systemDir } = tempStore(t);
    seed(store);
    const filePath = path.join(systemDir, fileName);
    const corruptJson = '{ not valid json';
    fs.writeFileSync(filePath, corruptJson, 'utf8');

    assert.throws(() => store.grant('choushiyiguai', 'choushiyiguai1', {
      capability: 'preset:draft',
      scope: 'novel-panel'
    }), SyntaxError);
    assert.equal(fs.readFileSync(filePath, 'utf8'), corruptJson);
    assert.equal(fs.existsSync(path.join(systemDir, 'system-transaction.json')), false);
  }
});

test('rejects an audit path that cannot be read before changing grants', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const auditPath = path.join(systemDir, 'audit.json');
  fs.mkdirSync(auditPath);

  assert.throws(() => store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  }));
  assert.equal(fs.existsSync(path.join(systemDir, 'grants.json')), false);
  assert.equal(fs.statSync(auditPath).isDirectory(), true);
});

test('recovers an interrupted grant transaction before a new store serves state', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const auditPath = path.join(systemDir, 'audit.json');
  const originalRename = fs.renameSync;

  fs.renameSync = function renameSync(source, destination) {
    if (destination === auditPath) {
      const error = new Error('injected audit write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRename.call(this, source, destination);
  };

  try {
    assert.throws(() => store.grant('choushiyiguai', 'choushiyiguai1', {
      capability: 'preset:draft',
      scope: 'novel-panel'
    }), /pending recovery/);
    assert.equal(fs.existsSync(path.join(systemDir, 'system-transaction.json')), true);
  } finally {
    fs.renameSync = originalRename;
  }

  const recovered = createAccountStore({ systemDir });
  assert.equal(recovered.can('choushiyiguai1', 'preset:draft', 'novel-panel'), true);
  assert.equal(recovered.listAudit().at(-1).action, 'grant.created');
  assert.equal(fs.existsSync(path.join(systemDir, 'system-transaction.json')), false);
});

test('rejects forged owner records and never grants their permissions', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const accountsPath = path.join(systemDir, 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  accounts[1].isOwner = true;
  fs.writeFileSync(accountsPath, JSON.stringify(accounts), 'utf8');

  assert.throws(() => store.can('choushiyiguai1', 'preset:draft', 'novel-panel'), /ownership/);
  assert.throws(() => createAccountStore({ systemDir }), /ownership/);
});

test('stores system files without group or other read permissions on POSIX', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  if (process.platform === 'win32') return;

  const systemMode = fs.statSync(systemDir).mode & 0o777;
  const accountMode = fs.statSync(path.join(systemDir, 'accounts.json')).mode & 0o777;
  assert.equal(systemMode & 0o077, 0);
  assert.equal(accountMode & 0o044, 0);
});
