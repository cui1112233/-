const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAccountStore } = require('../lib/account-store');
const { createMemberStore } = require('../lib/member-store');
const { createUsageStore } = require('../lib/usage-store');
const { resolveApiAccess } = require('../lib/api-access');

function fixture(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-member-center-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({
    choushiyiguai: '12345678',
    legacyuser: '12345678'
  });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  return { systemDir, accountStore, memberStore, usageStore };
}

function readyConfig(name) {
  return {
    provider: 'custom',
    baseUrl: 'https://example.invalid/v1',
    model: `${name}-model`,
    apiKey: `${name}-key`
  };
}

test('owner is always DEV while legacy accounts migrate as MEMBER profiles on read', t => {
  const { memberStore } = fixture(t);

  const owner = memberStore.getMember('choushiyiguai');
  const legacy = memberStore.getMember('legacyuser');

  assert.equal(owner.role, 'dev');
  assert.equal(owner.displayName, 'choushiyiguai');
  assert.equal(legacy.role, 'member');
  assert.equal(legacy.displayName, 'legacyuser');
  assert.equal(legacy.boundTo, null);
  assert.equal(legacy.apiEnabled, false);
});

test('MANAGER can only create MEMBER accounts bound to itself', t => {
  const { memberStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager01',
    password: 'password01',
    displayName: '管理一组',
    role: 'manager'
  });

  const member = memberStore.createManagedMember(manager.username, {
    username: 'member001',
    password: 'password01',
    displayName: '小林',
    role: 'dev',
    boundTo: 'someone-else',
    apiEnabled: true
  });

  assert.equal(manager.role, 'manager');
  assert.equal(member.role, 'member');
  assert.equal(member.boundTo, manager.username);
  assert.equal(member.apiEnabled, true);
  assert.deepEqual(member.apiScopes, ['*']);
});

test('DEV cannot leave a half-created account when API is requested without a team owner', t => {
  const { accountStore, memberStore } = fixture(t);

  assert.throws(
    () => memberStore.createManagedMember('choushiyiguai', {
      username: 'orphan001',
      password: 'password01',
      role: 'member',
      apiEnabled: true
    }),
    /未绑定团队负责人/
  );
  assert.equal(accountStore.getAccount('orphan001'), null);
});

test('manager cannot authorize a member owned by another manager', t => {
  const { memberStore } = fixture(t);
  const managerA = memberStore.createManagedMember('choushiyiguai', {
    username: 'managerA', password: 'password01', role: 'manager'
  });
  const managerB = memberStore.createManagedMember('choushiyiguai', {
    username: 'managerB', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember(managerA.username, {
    username: 'member002', password: 'password01'
  });

  assert.throws(
    () => memberStore.setApiAccess(managerB.username, member.username, true),
    error => error?.code === 'FORBIDDEN'
  );
});

test('authorized MEMBER resolves to its bound MANAGER API without exposing a member key', t => {
  const { accountStore, memberStore, usageStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager03', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember(manager.username, {
    username: 'member003', password: 'password01', apiEnabled: true
  });
  const configs = {
    [manager.username]: readyConfig('manager'),
    [member.username]: readyConfig('member')
  };

  const access = resolveApiAccess({
    accountStore,
    memberStore,
    usageStore,
    username: member.username,
    configReader: username => configs[username]
  });

  assert.equal(access.billedTo, manager.username);
  assert.equal(access.teamOwner, manager.username);
  assert.equal(access.config.apiKey, 'manager-key');
  assert.notEqual(access.config.apiKey, configs[member.username].apiKey);
});

test('DEV can own a team and its MEMBER inherits the DEV API configuration and quota owner', t => {
  const { accountStore, memberStore, usageStore } = fixture(t);
  const member = memberStore.createManagedMember('choushiyiguai', {
    username: 'dev-team-member',
    password: 'password01',
    displayName: '开发团队成员',
    role: 'member',
    boundTo: 'choushiyiguai',
    apiEnabled: true
  });
  const configs = {
    choushiyiguai: readyConfig('developer'),
    [member.username]: readyConfig('member')
  };

  const access = resolveApiAccess({
    accountStore,
    memberStore,
    usageStore,
    username: member.username,
    configReader: username => configs[username]
  });

  assert.equal(member.boundTo, 'choushiyiguai');
  assert.equal(access.billedTo, 'choushiyiguai');
  assert.equal(access.teamOwner, 'choushiyiguai');
  assert.equal(access.config.apiKey, 'developer-key');
});

test('MEMBER without api:use is rejected before any model configuration is returned', t => {
  const { accountStore, memberStore, usageStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager04', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember(manager.username, {
    username: 'member004', password: 'password01', apiEnabled: false
  });

  assert.throws(
    () => resolveApiAccess({
      accountStore,
      memberStore,
      usageStore,
      username: member.username,
      configReader: () => readyConfig('manager')
    }),
    error => error?.code === 'API_NOT_AUTHORIZED' && error?.status === 403
  );
});

test('monthly MEMBER quota is enforced from the usage ledger', t => {
  const { accountStore, memberStore, usageStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager05', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember(manager.username, {
    username: 'member005',
    password: 'password01',
    apiEnabled: true,
    monthlyTokenLimit: 100
  });
  usageStore.record({
    username: member.username,
    billedTo: manager.username,
    teamOwner: manager.username,
    feature: 'agent',
    provider: 'custom',
    model: 'demo',
    usage: { prompt_tokens: 70, completion_tokens: 30, total_tokens: 100 }
  });

  assert.throws(
    () => resolveApiAccess({
      accountStore,
      memberStore,
      usageStore,
      username: member.username,
      configReader: () => readyConfig('manager')
    }),
    error => error?.code === 'API_QUOTA_EXCEEDED' && error?.status === 429
  );
});

test('DEV cannot demote a MANAGER until its members are transferred', t => {
  const { memberStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager06', password: 'password01', role: 'manager'
  });
  memberStore.createManagedMember(manager.username, {
    username: 'member006', password: 'password01'
  });

  assert.throws(
    () => memberStore.updateManagedMember('choushiyiguai', manager.username, { role: 'member' }),
    error => error?.code === 'CONFLICT'
  );
});

test('DEV can promote an existing MEMBER to MANAGER', t => {
  const { memberStore } = fixture(t);
  const member = memberStore.createManagedMember('choushiyiguai', {
    username: 'promote001', password: 'password01', displayName: '待授权管理者'
  });

  const promoted = memberStore.updateManagedMember('choushiyiguai', member.username, {
    role: 'manager',
    boundTo: null
  });

  assert.equal(promoted.role, 'manager');
  assert.equal(promoted.boundTo, null);
  assert.equal(promoted.apiEnabled, false);
});

test('MANAGER audit filtering does not reacquire the member-store lock', t => {
  const { memberStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager07', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember(manager.username, {
    username: 'member007', password: 'password01'
  });
  memberStore.setApiAccess(manager.username, member.username, true);

  const audit = memberStore.listAudit(manager.username);
  assert.ok(audit.some(entry => entry.action === 'member.created' && entry.target === member.username));
  assert.ok(audit.some(entry => entry.action === 'api.enabled' && entry.target === member.username));
});
