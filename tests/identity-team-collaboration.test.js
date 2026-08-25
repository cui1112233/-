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
const { hotp } = require('../lib/mfa-store');
const { createAuthRouter } = require('../routes/auth');
const { createMemberCenterRouter } = require('../routes/member-center');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      server.close(() => fn(value));
    };
    server.once('error', error => done(reject, error));
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { done(resolve, { status: response.statusCode, body: text ? JSON.parse(text) : null }); }
          catch (error) { done(reject, error); }
        });
      });
      req.once('error', error => done(reject, error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-collab-'));
  const systemDir = path.join(root, 'system');
  const avatarsDir = path.join(root, 'avatars');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'owner-password', legacyuser: 'legacy-password' });
  const authRuntime = createAuthRuntime({ accountStore, tokenMap: new Map(), sessionsPath: path.join(root, 'sessions.json') });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const app = express();
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = memberStore;
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/login', createAuthRouter(authRuntime, memberStore));
  app.use('/api/member', createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore }));
  return { app, root, systemDir, accountStore, authRuntime, memberStore, usageStore };
}

async function login(app, username, password, mfaCode = '') {
  return request(app, { method: 'POST', requestPath: '/api/login', body: { username, password, remember: true, mfaCode } });
}

test('team entity, one-time invite, notifications and archive lifecycle work together', async t => {
  const fx = fixture(t);
  const owner = await login(fx.app, 'choushiyiguai', 'owner-password');
  assert.equal(owner.status, 200);
  const managerCreated = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members', token: owner.body.token,
    body: { username: 'manager03', password: 'manager-password', displayName: '内容主管', role: 'manager' }
  });
  assert.equal(managerCreated.status, 201);
  const managerLogin = await login(fx.app, 'manager03', 'manager-password');
  assert.equal(managerLogin.status, 200);
  const teamResult = await request(fx.app, { requestPath: '/api/member/team', token: managerLogin.body.token });
  assert.equal(teamResult.status, 200);
  assert.ok(teamResult.body.team.id);
  assert.equal(teamResult.body.team.managerUsername, 'manager03');

  const renamed = await request(fx.app, {
    method: 'PATCH', requestPath: `/api/member/team/meta/${teamResult.body.team.id}`, token: managerLogin.body.token,
    body: { name: '漫剧内容组' }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.team.name, '漫剧内容组');

  const createdInvite = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/invites', token: managerLogin.body.token,
    body: { expiresInHours: 12, monthlyTokenLimit: 5000, apiScopes: ['text', 'tts'] }
  });
  assert.equal(createdInvite.status, 201);
  assert.match(createdInvite.body.inviteUrl, /^\/invite\//);
  const rawToken = createdInvite.body.token;

  const inspected = await request(fx.app, { requestPath: `/api/login/invite/${encodeURIComponent(rawToken)}` });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.invite.teamName, '漫剧内容组');
  assert.deepEqual(inspected.body.invite.apiScopes, ['text', 'tts']);

  const redeemed = await request(fx.app, {
    method: 'POST', requestPath: `/api/login/invite/${encodeURIComponent(rawToken)}`,
    body: { username: 'invited01', password: 'invited-password', displayName: '小周' }
  });
  assert.equal(redeemed.status, 201);
  assert.equal(redeemed.body.member.boundTo, 'manager03');
  assert.equal(redeemed.body.member.monthlyTokenLimit, 5000);
  assert.equal(redeemed.body.member.apiScopes.includes('text'), true);
  assert.equal(redeemed.body.member.apiScopes.includes('tts'), true);
  assert.equal(redeemed.body.member.apiScopes.includes('image'), false);

  const duplicate = await request(fx.app, {
    method: 'POST', requestPath: `/api/login/invite/${encodeURIComponent(rawToken)}`,
    body: { username: 'invited02', password: 'invited-password', displayName: '第二人' }
  });
  assert.equal(duplicate.status, 409);
  assert.equal(fx.accountStore.getAccount('invited02'), null);

  const managerNotifications = await request(fx.app, { requestPath: '/api/member/notifications', token: managerLogin.body.token });
  assert.equal(managerNotifications.status, 200);
  assert.ok(managerNotifications.body.entries.some(item => item.type === 'member.joined' && item.metadata?.username === 'invited01'));

  const invitedLogin = await login(fx.app, 'invited01', 'invited-password');
  assert.equal(invitedLogin.status, 200);
  const archive = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/invited01/archive', token: managerLogin.body.token,
    body: { reason: '项目结束' }
  });
  assert.equal(archive.status, 200);
  assert.ok(archive.body.archive.archivedAt);
  assert.equal(fx.accountStore.getAccount('invited01').active, false);
  assert.equal(fx.authRuntime.tokenMap.has(invitedLogin.body.token), false);

  const blockedLogin = await login(fx.app, 'invited01', 'invited-password');
  assert.equal(blockedLogin.status, 401);
  const restored = await request(fx.app, { method: 'POST', requestPath: '/api/member/team/members/invited01/restore', token: managerLogin.body.token });
  assert.equal(restored.status, 200);
  assert.equal(fx.accountStore.getAccount('invited01').active, true);
  const restoredLogin = await login(fx.app, 'invited01', 'invited-password');
  assert.equal(restoredLogin.status, 200);
});

test('TOTP MFA blocks password-only login and recovery codes are one-time', async t => {
  const fx = fixture(t);
  const owner = await login(fx.app, 'choushiyiguai', 'owner-password');
  assert.equal(owner.status, 200);

  const setup = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/security/mfa/setup', token: owner.body.token,
    body: { currentPassword: 'owner-password' }
  });
  assert.equal(setup.status, 200);
  assert.match(setup.body.secret, /^[A-Z2-7]+$/);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const code = hotp(setup.body.secret, counter);
  const enabled = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/security/mfa/enable', token: owner.body.token,
    body: { code }
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.status.enabled, true);
  assert.equal(enabled.body.recoveryCodes.length, 8);

  const noMfa = await login(fx.app, 'choushiyiguai', 'owner-password');
  assert.equal(noMfa.status, 428);
  assert.equal(noMfa.body.code, 'MFA_REQUIRED');

  const freshCode = hotp(setup.body.secret, Math.floor(Date.now() / 1000 / 30));
  const withMfa = await login(fx.app, 'choushiyiguai', 'owner-password', freshCode);
  assert.equal(withMfa.status, 200);
  assert.equal(withMfa.body.mfaEnabled, true);

  const recovery = enabled.body.recoveryCodes[0];
  const recoveryLogin = await login(fx.app, 'choushiyiguai', 'owner-password', recovery);
  assert.equal(recoveryLogin.status, 200);
  assert.equal(recoveryLogin.body.mfaRecoveryUsed, true);
  const reused = await login(fx.app, 'choushiyiguai', 'owner-password', recovery);
  assert.equal(reused.status, 401);

  const security = await request(fx.app, { requestPath: '/api/member/security', token: withMfa.body.token });
  assert.equal(security.status, 200);
  assert.equal(security.body.mfa.enabled, true);
  assert.equal(security.body.mfa.recoveryCodesRemaining, 7);
});
