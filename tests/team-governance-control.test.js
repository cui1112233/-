const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createAccountStore } = require('../lib/account-store');
const { createAuthRuntime } = require('../lib/shared');
const { createMemberStore } = require('../lib/member-store');
const { createUsageStore } = require('../lib/usage-store');
const { createTeamGovernanceStore, quotaState } = require('../lib/team-governance-store');
const { resolveTeamAuthorization } = require('../lib/api-access');
const { createAuthRouter } = require('../routes/auth');
const { createMemberCenterRouter } = require('../routes/member-center');

function request(app, { method = 'GET', requestPath, body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
    let settled = false;

    function closeThen(callback) {
      if (!server.listening) return callback();
      server.close(error => error ? reject(error) : callback());
    }

    function succeed(value) {
      if (settled) return;
      settled = true;
      closeThen(() => resolve(value));
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      closeThen(() => reject(error));
    }

    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('error', fail);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            succeed({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          } catch (error) {
            fail(error);
          }
        });
      });
      req.once('error', fail);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-governance-'));
  const systemDir = path.join(root, 'system');
  const avatarsDir = path.join(root, 'avatars');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'owner-password', legacyuser: 'legacy-password' });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(root, 'sessions.json')
  });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const governanceStore = createTeamGovernanceStore({ systemDir });

  const app = express();
  app.set('trust proxy', true);
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = memberStore;
  app.locals.usageStore = usageStore;
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/login', createAuthRouter(authRuntime, memberStore));
  app.use('/api/member', createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore }));

  return { app, root, systemDir, accountStore, authRuntime, memberStore, usageStore, governanceStore };
}

async function login(app, username, password, { remember = false, headers = {} } = {}) {
  return request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password, remember },
    headers
  });
}

test('quota state uses 70/90/100 warning thresholds', () => {
  assert.equal(quotaState(69, 100).level, 'normal');
  assert.equal(quotaState(70, 100).level, 'warning');
  assert.equal(quotaState(90, 100).level, 'critical');
  assert.equal(quotaState(100, 100).level, 'exhausted');
  assert.equal(quotaState(1, null).level, 'unlimited');
});

test('team total quota and API scopes are enforced server-side', t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'manager02', password: 'manager-password', role: 'manager'
  });
  const member = fx.memberStore.createManagedMember(manager.username, {
    username: 'member02', password: 'member-password', apiEnabled: false
  });
  fx.memberStore.setApiAccess(manager.username, member.username, true, 'text');
  fx.governanceStore.update(manager.username, { monthlyTokenLimit: 100 }, manager.username);

  let access = resolveTeamAuthorization({
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: member.username,
    scope: 'text'
  });
  assert.equal(access.teamQuota.level, 'normal');
  assert.equal(access.billedTo, manager.username);

  assert.throws(() => resolveTeamAuthorization({
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: member.username,
    scope: 'image'
  }), error => error?.code === 'API_NOT_AUTHORIZED');
  assert.throws(() => resolveTeamAuthorization({
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: member.username,
    scope: 'tts'
  }), error => error?.code === 'API_NOT_AUTHORIZED');

  fx.memberStore.setApiAccess(manager.username, member.username, true, 'image');
  fx.memberStore.setApiAccess(manager.username, member.username, true, 'tts');
  assert.equal(resolveTeamAuthorization({ memberStore: fx.memberStore, usageStore: fx.usageStore, username: member.username, scope: 'image' }).scope, 'image');
  assert.equal(resolveTeamAuthorization({ memberStore: fx.memberStore, usageStore: fx.usageStore, username: member.username, scope: 'tts' }).scope, 'tts');

  fx.usageStore.record({
    username: member.username,
    billedTo: manager.username,
    teamOwner: manager.username,
    feature: 'chat',
    usage: { prompt_tokens: 70, completion_tokens: 0, total_tokens: 70 },
    metadata: { usageEstimated: false }
  });
  access = resolveTeamAuthorization({ memberStore: fx.memberStore, usageStore: fx.usageStore, username: member.username, scope: 'text' });
  assert.equal(access.teamQuota.level, 'warning');

  fx.usageStore.record({
    username: member.username,
    billedTo: manager.username,
    teamOwner: manager.username,
    feature: 'chat',
    usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    metadata: { usageEstimated: false }
  });
  access = resolveTeamAuthorization({ memberStore: fx.memberStore, usageStore: fx.usageStore, username: member.username, scope: 'text' });
  assert.equal(access.teamQuota.level, 'critical');

  fx.usageStore.record({
    username: member.username,
    billedTo: manager.username,
    teamOwner: manager.username,
    feature: 'chat',
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    metadata: { usageEstimated: false }
  });
  assert.throws(() => resolveTeamAuthorization({
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: member.username,
    scope: 'text'
  }), error => error?.code === 'TEAM_API_QUOTA_EXCEEDED' && error?.status === 429);
});

test('usage ledger snapshots pricing and estimates cost without rewriting history', t => {
  const fx = fixture(t);
  const first = fx.usageStore.record({
    username: 'legacyuser',
    billedTo: 'legacyuser',
    feature: 'chat',
    model: 'demo-model',
    usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000, total_tokens: 1_500_000 },
    pricing: { currency: 'USD', inputPerMillion: 1, outputPerMillion: 4 },
    metadata: { usageEstimated: false }
  });
  assert.equal(first.costKnown, true);
  assert.equal(first.estimatedCost, 3);
  assert.deepEqual(first.pricingSnapshot, { currency: 'USD', inputPerMillion: 1, outputPerMillion: 4 });

  const second = fx.usageStore.record({
    username: 'legacyuser',
    billedTo: 'legacyuser',
    feature: 'chat',
    model: 'demo-model',
    usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
    pricing: { currency: 'USD', inputPerMillion: 2, outputPerMillion: 8 },
    metadata: { usageEstimated: false }
  });
  assert.equal(second.estimatedCost, 2);
  const summary = fx.usageStore.summaryForUser('legacyuser', 'month');
  assert.equal(summary.estimatedCost, 5);
  assert.equal(summary.costCurrency, 'USD');
  assert.equal(summary.pricedCalls, 2);
});

test('manager can disable restore and reset its own member while sessions are revoked', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'manager03', password: 'manager-password', role: 'manager'
  });
  fx.memberStore.createManagedMember(manager.username, {
    username: 'member03', password: 'member-old-password', apiEnabled: true
  });

  const managerLogin = await login(fx.app, manager.username, 'manager-password');
  assert.equal(managerLogin.status, 200);
  const managerToken = managerLogin.body.token;

  const memberLogin = await login(fx.app, 'member03', 'member-old-password', {
    remember: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
      'X-Forwarded-For': '203.0.113.42'
    }
  });
  assert.equal(memberLogin.status, 200);
  const memberToken = memberLogin.body.token;

  const security = await request(fx.app, { requestPath: '/api/member/security', token: memberToken });
  assert.equal(security.status, 200);
  assert.equal(security.body.sessions[0].browser, 'Chrome');
  assert.equal(security.body.sessions[0].os, 'Windows');
  assert.equal(security.body.sessions[0].ipHint, '203.0.*.*');

  const disabled = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/member03/status', token: managerToken, body: { active: false }
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.member.active, false);
  assert.ok(disabled.body.revoked.runtime >= 1);

  const staleSession = await request(fx.app, { requestPath: '/api/member/security', token: memberToken });
  assert.equal(staleSession.status, 401);
  const disabledLogin = await login(fx.app, 'member03', 'member-old-password');
  assert.equal(disabledLogin.status, 401);

  const restored = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/member03/status', token: managerToken, body: { active: true }
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.member.active, true);

  const reset = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/member03/reset-password', token: managerToken, body: { password: 'member-new-password' }
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.changed, true);
  assert.equal((await login(fx.app, 'member03', 'member-old-password')).status, 401);
  assert.equal((await login(fx.app, 'member03', 'member-new-password')).status, 200);
});

test('manager API scope endpoint replaces wildcard permission with explicit scopes', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'manager04', password: 'manager-password', role: 'manager'
  });
  fx.memberStore.createManagedMember(manager.username, {
    username: 'member04', password: 'member-password', apiEnabled: true
  });
  const managerLogin = await login(fx.app, manager.username, 'manager-password');
  const response = await request(fx.app, {
    method: 'PUT',
    requestPath: '/api/member/team/members/member04/api-scopes',
    token: managerLogin.body.token,
    body: { scopes: ['text', 'image'] }
  });
  assert.equal(response.status, 200);
  assert.deepEqual([...response.body.member.apiScopes].sort(), ['image', 'text']);
  assert.equal(fx.memberStore.canUseApi('member04', 'text'), true);
  assert.equal(fx.memberStore.canUseApi('member04', 'image'), true);
  assert.equal(fx.memberStore.canUseApi('member04', 'tts'), false);
});
