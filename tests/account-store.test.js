const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAccountStore } = require('../lib/account-store');
const { writeJsonAtomic } = require('../lib/system-store');

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

function waitForFile(filePath, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${path.basename(filePath)}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function spawnBlockedGrant({ systemDir, capability, readyPath, releasePath }) {
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const systemStore = require(path.join(process.env.QIANTIE_ROOT, 'lib/system-store'));
    const originalWrite = systemStore.writeJsonTransaction;
    systemStore.writeJsonTransaction = (...args) => {
      fs.writeFileSync(process.env.QIANTIE_READY, 'ready', 'utf8');
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(process.env.QIANTIE_RELEASE)) {
        if (Date.now() >= deadline) throw new Error('barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      return originalWrite(...args);
    };
    const { createAccountStore } = require(path.join(process.env.QIANTIE_ROOT, 'lib/account-store'));
    const store = createAccountStore({ systemDir: process.env.QIANTIE_SYSTEM_DIR });
    store.grant('choushiyiguai', 'choushiyiguai1', {
      capability: process.env.QIANTIE_CAPABILITY,
      scope: 'novel-panel'
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      QIANTIE_ROOT: path.resolve(__dirname, '..'),
      QIANTIE_SYSTEM_DIR: systemDir,
      QIANTIE_CAPABILITY: capability,
      QIANTIE_READY: readyPath,
      QIANTIE_RELEASE: releasePath
    }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`grant child exited ${code}: ${stderr}`));
    });
  });
}

function spawnLockHolder({ lockPath, readyPath }) {
  const script = `
    const fs = require('node:fs');
    const { withJsonLock } = require(process.env.QIANTIE_SYSTEM_STORE);
    withJsonLock(process.env.QIANTIE_LOCK_PATH, () => {
      fs.writeFileSync(process.env.QIANTIE_READY, 'locked', 'utf8');
      while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }, { timeoutMs: 5000 });
  `;
  return spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      QIANTIE_SYSTEM_STORE: path.resolve(__dirname, '../lib/system-store'),
      QIANTIE_LOCK_PATH: lockPath,
      QIANTIE_READY: readyPath
    }
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

test('persists custom seed sources across store reloads', t => {
  const { store, systemDir } = tempStore(t);
  store.ensureSeedAccounts({
    choushiyiguai: '123456',
    customseed: '123456'
  });

  const reopened = createAccountStore({ systemDir });
  const customSeed = reopened.getAccount('customseed');
  assert.equal(customSeed.active, true);
  assert.equal(Object.hasOwn(customSeed, 'source'), false);
  assert.equal(reopened.setActive('customseed', false).active, false);
  assert.equal(reopened.createAccount({ username: 'writer_01', password: 'secret-123' }).username, 'writer_01');
});

test('accepts legacy built-in seeds without source markers', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const accountsPath = path.join(systemDir, 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  for (const account of accounts) delete account.source;
  fs.writeFileSync(accountsPath, JSON.stringify(accounts), 'utf8');

  const reopened = createAccountStore({ systemDir });
  assert.equal(reopened.getAccount('choushiyiguai1').active, true);
  assert.equal(reopened.setActive('choushiyiguai1', false).active, false);
});

test('keeps password hashes internal while verifying passwords securely', t => {
  const { store } = tempStore(t);
  seed(store);

  const account = store.getAccount('choushiyiguai');
  assert.equal(Object.hasOwn(account, 'passwordHash'), false);
  assert.equal(store.verifyPassword('choushiyiguai', '123456'), true);
  assert.equal(store.verifyPassword('choushiyiguai', 'wrong-password'), false);
});

test('creates an account with an atomic safe audit record', t => {
  const { store } = tempStore(t);
  seed(store);

  const account = store.createAccount({
    username: 'writer_01',
    password: 'secret-123'
  });

  assert.equal(account.username, 'writer_01');
  assert.equal(store.verifyPassword('writer_01', 'secret-123'), true);
  const audit = store.listAudit().at(-1);
  assert.equal(audit.action, 'account.created');
  assert.equal(audit.target, 'writer_01');
  assert.equal(audit.before, null);
  assert.deepEqual(audit.after, { active: true, isOwner: false });
  assert.doesNotMatch(JSON.stringify(audit), /secret-123|passwordHash/);
});

test('keeps account creation audit valid after active state changes', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.createAccount({ username: 'writer_01', password: 'secret-123' });

  assert.equal(store.setActive('writer_01', false).active, false);
  const reopened = createAccountStore({ systemDir });
  assert.equal(reopened.getAccount('writer_01').active, false);
  assert.equal(reopened.setActive('writer_01', true).active, true);
});

test('rejects an account creation audit reassigned to another account', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.createAccount({ username: 'writer_01', password: 'secret-123' });
  store.createAccount({ username: 'writer_02', password: 'secret-456' });
  const auditPath = path.join(systemDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

  audit.find(entry => entry.action === 'account.created' && entry.target === 'writer_01').target = 'writer_02';
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');

  assert.throws(() => createAccountStore({ systemDir }), /Invalid audit store/);
});

test('rejects a modified account creation active snapshot', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.createAccount({ username: 'writer_01', password: 'secret-123' });
  const auditPath = path.join(systemDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

  audit.find(entry => entry.action === 'account.created').after.active = false;
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');

  assert.throws(() => createAccountStore({ systemDir }), /Invalid audit store/);
});

test('rejects a direct creation audit rewritten as an approved account', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.createAccount({ username: 'writer_01', password: 'secret-123' });
  const application = store.submitApplication({
    username: 'writer_02', password: 'secret-456', reason: '小说创作'
  });
  store.approveApplication('choushiyiguai', application.id);
  const auditPath = path.join(systemDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const approved = store.getInternalAccount('writer_02');
  const directCreation = audit.find(entry => entry.action === 'account.created' && entry.target === 'writer_01');

  directCreation.target = 'writer_02';
  directCreation.at = approved.createdAt;
  directCreation.after = { active: true, isOwner: false };
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');

  assert.throws(() => createAccountStore({ systemDir }), /Invalid audit store/);
});

test('accepts a legacy account creation audit with a different timestamp', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.createAccount({ username: 'writer_01', password: 'secret-123' });
  const auditPath = path.join(systemDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

  audit.find(entry => entry.action === 'account.created').at = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');

  assert.equal(createAccountStore({ systemDir }).getAccount('writer_01').active, true);
});

test('rejects forged owners and unsafe fields in account creation audits', t => {
  for (const mutate of [
    entry => { entry.after.isOwner = true; },
    entry => { entry.after.passwordHash = 'should-not-leak'; },
    entry => { entry.after.extra = true; }
  ]) {
    const { store, systemDir } = tempStore(t);
    seed(store);
    store.createAccount({ username: 'writer_01', password: 'secret-123' });
    const auditPath = path.join(systemDir, 'audit.json');
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

    mutate(audit.find(entry => entry.action === 'account.created'));
    fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');

    assert.throws(() => createAccountStore({ systemDir }), /Invalid audit store/);
  }
});

test('recovers a direct account creation together with its audit record', t => {
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
    assert.throws(() => store.createAccount({
      username: 'writer_01',
      password: 'secret-123'
    }), /pending recovery/);
    assert.equal(fs.existsSync(path.join(systemDir, 'system-transaction.json')), true);
  } finally {
    fs.renameSync = originalRename;
  }

  const recovered = createAccountStore({ systemDir });
  assert.equal(recovered.verifyPassword('writer_01', 'secret-123'), true);
  assert.equal(recovered.listAudit().at(-1).action, 'account.created');
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

test('serializes concurrent grants from separate store processes', async t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const releasePath = path.join(systemDir, 'release-grants');
  const readyDraft = path.join(systemDir, 'ready-draft');
  const readyPublish = path.join(systemDir, 'ready-publish');
  const draft = spawnBlockedGrant({
    systemDir,
    capability: 'preset:draft',
    readyPath: readyDraft,
    releasePath
  });

  await waitForFile(readyDraft);
  const publish = spawnBlockedGrant({
    systemDir,
    capability: 'preset:publish',
    readyPath: readyPublish,
    releasePath
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(fs.existsSync(readyPublish), false);
  } finally {
    fs.writeFileSync(releasePath, 'release', 'utf8');
    await Promise.all([draft, publish]);
  }

  const reloaded = createAccountStore({ systemDir });
  assert.deepEqual(
    new Set(reloaded.listGrants('choushiyiguai1').map(grant => grant.capability)),
    new Set(['preset:draft', 'preset:publish'])
  );
  assert.deepEqual(
    new Set(reloaded.listAudit().map(entry => entry.after.capability)),
    new Set(['preset:draft', 'preset:publish'])
  );
});

test('fails closed for forged grants and malformed account activity', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const grantsPath = path.join(systemDir, 'grants.json');
  fs.writeFileSync(grantsPath, JSON.stringify([{
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: 'choushiyiguai1',
    subject: 'choushiyiguai1',
    capability: 'preset:publish',
    scope: 'novel-panel'
  }]), 'utf8');

  assert.throws(() => store.can('choushiyiguai1', 'preset:publish', 'novel-panel'), /Invalid grant/);

  fs.unlinkSync(grantsPath);
  const accountsPath = path.join(systemDir, 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  accounts[1].active = 'false';
  fs.writeFileSync(accountsPath, JSON.stringify(accounts), 'utf8');
  assert.throws(() => store.getAccount('choushiyiguai1'), /Invalid account/);
});

test('rejects semantically invalid journal writes before they reach grants', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const grantsPath = path.join(systemDir, 'grants.json');
  const auditPath = path.join(systemDir, 'audit.json');
  const journalPath = path.join(systemDir, 'system-transaction.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes: [
      {
        filePath: grantsPath,
        value: [{
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actor: 'choushiyiguai1',
          subject: 'choushiyiguai1',
          capability: 'preset:publish',
          scope: 'novel-panel'
        }]
      },
      { filePath: auditPath, value: [] }
    ]
  }), 'utf8');

  assert.throws(() => createAccountStore({ systemDir }), /Invalid grant/);
  assert.equal(fs.existsSync(grantsPath), false);
  assert.equal(fs.existsSync(journalPath), true);
});

test('keeps a renamed JSON replacement successful when directory sync fails', t => {
  const { systemDir } = tempStore(t);
  const filePath = path.join(systemDir, 'durability.json');
  const originalFsync = fs.fsyncSync;
  let calls = 0;
  fs.fsyncSync = descriptor => {
    calls += 1;
    if (calls === 2) {
      const error = new Error('injected directory sync failure');
      error.code = 'EIO';
      throw error;
    }
    return originalFsync(descriptor);
  };

  try {
    assert.doesNotThrow(() => writeJsonAtomic(filePath, { durable: true }));
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { durable: true });
});

test('reclaims a SIGKILLed holder lock and recovers its pending journal', async t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const grant = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: 'choushiyiguai',
    subject: 'choushiyiguai1',
    capability: 'preset:draft',
    scope: 'novel-panel'
  };
  const journalPath = path.join(systemDir, 'system-transaction.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes: [
      { filePath: path.join(systemDir, 'grants.json'), value: [grant] },
      {
        filePath: path.join(systemDir, 'audit.json'),
        value: [{
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actor: 'choushiyiguai',
          action: 'grant.created',
          target: 'choushiyiguai1',
          before: null,
          after: grant
        }]
      }
    ]
  }), 'utf8');

  const lockPath = path.join(systemDir, 'system-store.lock');
  const readyPath = path.join(systemDir, 'lock-holder-ready');
  const holder = spawnLockHolder({ lockPath, readyPath });
  t.after(() => {
    if (holder.exitCode === null) holder.kill('SIGKILL');
  });
  await waitForFile(readyPath);
  holder.kill('SIGKILL');
  await new Promise(resolve => holder.once('exit', resolve));

  const recovered = createAccountStore({ systemDir, lockTimeoutMs: 500 });
  assert.equal(recovered.can('choushiyiguai1', 'preset:draft', 'novel-panel'), true);
  assert.equal(fs.existsSync(journalPath), false);
});

test('does not reclaim a lock owned by a live process', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const lockPath = path.join(systemDir, 'system-store.lock');
  fs.writeFileSync(lockPath, JSON.stringify({
    token: crypto.randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString()
  }), { encoding: 'utf8', mode: 0o600 });

  assert.throws(() => createAccountStore({ systemDir, lockTimeoutMs: 50, lockRetryMs: 5 }), /Timed out acquiring/);
  assert.equal(fs.existsSync(lockPath), true);
});

test('rejects unallowlisted sensitive fields before public projections can leak them', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const accountsPath = path.join(systemDir, 'accounts.json');
  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  accounts[1].apiKey = 'should-not-leak';
  fs.writeFileSync(accountsPath, JSON.stringify(accounts), 'utf8');
  assert.throws(() => store.getAccount('choushiyiguai1'), /Invalid account/);

  const { store: grantStore, systemDir: grantDir } = tempStore(t);
  seed(grantStore);
  fs.writeFileSync(path.join(grantDir, 'grants.json'), JSON.stringify([{
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: 'choushiyiguai',
    subject: 'choushiyiguai1',
    capability: 'preset:draft',
    scope: 'novel-panel',
    token: 'should-not-leak'
  }]), 'utf8');
  assert.throws(() => grantStore.listGrants(), /Invalid grant/);

  const { store: auditStore, systemDir: auditDir } = tempStore(t);
  seed(auditStore);
  auditStore.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  });
  const auditPath = path.join(auditDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  audit[0].before = { api_key: 'should-not-leak' };
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');
  assert.throws(() => auditStore.listAudit(), /Invalid audit/);
});

test('recovers when a dead claimant left a unique stale claim behind', async t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const grant = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: 'choushiyiguai',
    subject: 'choushiyiguai1',
    capability: 'preset:draft',
    scope: 'novel-panel'
  };
  const journalPath = path.join(systemDir, 'system-transaction.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes: [
      { filePath: path.join(systemDir, 'grants.json'), value: [grant] },
      {
        filePath: path.join(systemDir, 'audit.json'),
        value: [{
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actor: 'choushiyiguai',
          action: 'grant.created',
          target: 'choushiyiguai1',
          before: null,
          after: grant
        }]
      }
    ]
  }), 'utf8');
  const lockPath = path.join(systemDir, 'system-store.lock');
  const readyPath = path.join(systemDir, 'orphan-claim-holder-ready');
  const holder = spawnLockHolder({ lockPath, readyPath });
  t.after(() => {
    if (holder.exitCode === null) holder.kill('SIGKILL');
  });
  await waitForFile(readyPath);
  holder.kill('SIGKILL');
  await new Promise(resolve => holder.once('exit', resolve));

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const nonce = lock.token;
  const claimPath = `${lockPath}.${nonce}.stale-claim`;
  const claimRefPath = `${claimPath}.ref`;
  fs.writeFileSync(claimPath, JSON.stringify({
    nonce,
    pid: holder.pid,
    createdAt: new Date().toISOString(),
    lockToken: lock.token
  }), 'utf8');
  fs.linkSync(lockPath, claimRefPath);

  const recovered = createAccountStore({ systemDir, lockTimeoutMs: 500 });
  assert.equal(recovered.can('choushiyiguai1', 'preset:draft', 'novel-panel'), true);
  assert.equal(fs.existsSync(journalPath), false);
});

test('reclaims an invalid empty lock before recovering a pending journal', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  const grant = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: 'choushiyiguai',
    subject: 'choushiyiguai1',
    capability: 'preset:draft',
    scope: 'novel-panel'
  };
  const journalPath = path.join(systemDir, 'system-transaction.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    writes: [
      { filePath: path.join(systemDir, 'grants.json'), value: [grant] },
      {
        filePath: path.join(systemDir, 'audit.json'),
        value: [{
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actor: 'choushiyiguai',
          action: 'grant.created',
          target: 'choushiyiguai1',
          before: null,
          after: grant
        }]
      }
    ]
  }), 'utf8');
  fs.writeFileSync(path.join(systemDir, 'system-store.lock'), '', 'utf8');

  const recovered = createAccountStore({ systemDir, lockTimeoutMs: 500 });
  assert.equal(recovered.can('choushiyiguai1', 'preset:draft', 'novel-panel'), true);
  assert.equal(fs.existsSync(journalPath), false);
});

test('requires a null audit before value and an exact after grant projection', t => {
  const { store, systemDir } = tempStore(t);
  seed(store);
  store.grant('choushiyiguai', 'choushiyiguai1', {
    capability: 'preset:draft',
    scope: 'novel-panel'
  });
  const auditPath = path.join(systemDir, 'audit.json');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  audit[0].before = { harmless: true };
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');
  assert.throws(() => store.listAudit(), /Invalid audit/);

  audit[0].before = null;
  audit[0].after.access_token = 'should-not-leak';
  fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');
  assert.throws(() => store.listAudit(), /Invalid (grant|audit)/);
});
