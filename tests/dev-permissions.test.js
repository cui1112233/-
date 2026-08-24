const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAccountStore } = require('../lib/account-store');
const { createMemberStore } = require('../lib/member-store');
const { DEV_CAPABILITIES, ensureDevBackendPermissions } = require('../lib/dev-permissions');

function fixture(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-dev-perms-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: '12345678' });
  const memberStore = createMemberStore({ systemDir, accountStore });
  return { accountStore, memberStore };
}

test('promoted DEV receives all legacy backend capabilities at global scope', t => {
  const { accountStore, memberStore } = fixture(t);
  let member = memberStore.createManagedMember('choushiyiguai', {
    username: 'developer01',
    password: 'password01',
    role: 'member'
  });
  member = memberStore.updateManagedMember('choushiyiguai', member.username, { role: 'dev' });

  ensureDevBackendPermissions(accountStore, member);
  const grants = accountStore.listGrants().filter(grant => grant.subject === member.username);

  for (const capability of DEV_CAPABILITIES) {
    assert.ok(grants.some(grant => grant.capability === capability && grant.scope === '*'), capability);
    assert.equal(accountStore.can(member.username, capability, 'novel-panel'), true);
  }
});

test('syncing DEV permissions twice is idempotent', t => {
  const { accountStore, memberStore } = fixture(t);
  const member = memberStore.createManagedMember('choushiyiguai', {
    username: 'developer02',
    password: 'password01',
    role: 'dev'
  });

  ensureDevBackendPermissions(accountStore, member);
  ensureDevBackendPermissions(accountStore, member);

  const grants = accountStore.listGrants().filter(grant => grant.subject === member.username);
  assert.equal(grants.length, DEV_CAPABILITIES.length);
});
