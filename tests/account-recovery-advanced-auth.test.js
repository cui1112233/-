const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { createDeletedAccountGuard } = require('../middleware/deleted-account-guard');
const { createAccountStore } = require('../lib/account-store');
const { createAuthRuntime } = require('../lib/shared');
const { createMemberStore } = require('../lib/member-store');
const { createUsageStore } = require('../lib/usage-store');
const { createProfileDetailsStore } = require('../lib/profile-details-store');
const { createAccountRecoveryStore } = require('../lib/account-recovery-store');
const { createPasskeyStore } = require('../lib/passkey-store');
const { createMfaStore, hotp } = require('../lib/mfa-store');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { createAuthRouter } = require('../routes/auth');
const { createMemberCenterRouter } = require('../routes/member-center');
const { createAccountRecoveryRouter } = require('../routes/account-recovery');
const { createTeamAdminRouter } = require('../routes/team-admin');

function request(app, { method = 'GET', requestPath, body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
    let settled = false;

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      if (!server.listening) return fn(value);
      server.close(() => fn(value));
    }

    server.once('error', error => finish(reject, error));
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
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { finish(resolve, { status: response.statusCode, body: text ? JSON.parse(text) : null }); }
          catch (error) { finish(reject, error); }
        });
      });
      req.once('error', error => finish(reject, error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function fixture(t, { mailConfigured = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-advanced-auth-'));
  const systemDir = path.join(root, 'system');
  const avatarsDir = path.join(root, 'avatars');
  fs.mkdirSync(systemDir, { recursive: true });
  fs.mkdirSync(avatarsDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'owner-password', legacyuser: 'legacy-password' });
  const authRuntime = createAuthRuntime({ accountStore, tokenMap: new Map(), sessionsPath: path.join(root, 'sessions.json') });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const recoveryStore = createAccountRecoveryStore({ systemDir });
  const passkeyStore = createPasskeyStore({ systemDir });
  const mails = [];
  const mailer = mailConfigured ? {
    isConfigured: true,
    async send(mail) { mails.push({ ...mail }); return { accepted: true }; }
  } : {
    isConfigured: false,
    async send() { const error = new Error('邮件发送通道尚未配置'); error.code = 'MAIL_UNAVAILABLE'; throw error; }
  };

  const app = express();
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = memberStore;
  app.locals.usageStore = usageStore;
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/login', createAuthRouter(authRuntime, memberStore, { passkeyStore }));
  const deletedGuard = createDeletedAccountGuard(recoveryStore);
  app.use('/api/account-recovery/purge/:username', apiAuth, deletedGuard);
  app.use('/api/member/team/members/:username', apiAuth, deletedGuard);
  app.use('/api/team-admin/teams/:teamId/members/:username', apiAuth, deletedGuard);
  app.use('/api/account-recovery', createAccountRecoveryRouter({
    accountStore, memberStore, authRuntime, mailer, recoveryStore, passkeyStore, avatarsDir
  }));
  app.use('/api/team-admin', createTeamAdminRouter({ memberStore, usageStore, accountStore, authRuntime }));
  app.use('/api/member', createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore }));

  return {
    app, root, systemDir, avatarsDir, accountStore, authRuntime, memberStore, usageStore,
    recoveryStore, passkeyStore, profileStore: createProfileDetailsStore({ systemDir }),
    collaborationStore: createTeamCollaborationStore({ systemDir }), mails
  };
}

async function login(app, username, password, extra = {}) {
  return request(app, { method: 'POST', requestPath: '/api/login', body: { username, password, remember: true, ...extra } });
}

function tokenFromMail(mail, key) {
  const match = String(mail?.text || '').match(new RegExp(`[?&]${key}=([A-Za-z0-9_-]+)`));
  assert.ok(match, `mail should contain ${key} token`);
  return match[1];
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function clientData(type, challenge, origin = 'http://localhost') {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

function createTestPasskey(store, username, { origin = 'http://localhost', rpId = 'localhost', credentialId = `cred-${username}` } = {}) {
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const options = store.beginRegistration(username, { rpId, origin, displayName: username });
  const client = clientData('webauthn.create', options.challenge, origin);
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' });
  const credential = store.finishRegistration(username, {
    credentialId,
    publicKey: b64url(publicKey),
    algorithm: -7,
    transports: ['internal'],
    name: 'Test Passkey',
    clientDataJSON: b64url(client),
    challenge: options.challenge,
    origin,
    rpId
  });
  return { ...keys, credential, credentialId, origin, rpId };
}

function signAssertion(store, username, keys, counter) {
  const options = store.beginAuthentication(username, { rpId: keys.rpId, origin: keys.origin });
  const client = clientData('webauthn.get', options.challenge, keys.origin);
  const rpHash = crypto.createHash('sha256').update(keys.rpId).digest();
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([rpHash, Buffer.from([0x01]), count]);
  const clientHash = crypto.createHash('sha256').update(client).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, clientHash]), keys.privateKey);
  return {
    credentialId: keys.credentialId,
    authenticatorData: b64url(authenticatorData),
    signature: b64url(signature),
    clientDataJSON: b64url(client),
    challenge: options.challenge,
    origin: keys.origin,
    rpId: keys.rpId
  };
}

test('verified email recovery uses one-time tokens and revokes old sessions', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'manager04', password: 'manager-password', displayName: '账号主管', role: 'manager'
  });
  fx.memberStore.createManagedMember(manager.username, {
    username: 'recover04', password: 'old-password', displayName: '找回测试', role: 'member'
  });

  const memberLogin = await login(fx.app, 'recover04', 'old-password');
  assert.equal(memberLogin.status, 200);
  const profile = await request(fx.app, {
    method: 'PATCH', requestPath: '/api/member/profile', token: memberLogin.body.token,
    body: { displayName: '找回测试', email: 'Recover04@Example.com' }
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.member.email, 'recover04@example.com');

  const statusBefore = await request(fx.app, { requestPath: '/api/account-recovery/email/status', token: memberLogin.body.token });
  assert.equal(statusBefore.status, 200);
  assert.equal(statusBefore.body.verified, false);
  assert.equal(statusBefore.body.deliveryConfigured, true);

  const requestedVerification = await request(fx.app, { method: 'POST', requestPath: '/api/account-recovery/email/request', token: memberLogin.body.token });
  assert.equal(requestedVerification.status, 200);
  assert.equal(fx.mails.length, 1);
  const verifyToken = tokenFromMail(fx.mails[0], 'verify');

  const verified = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/email/verify', body: { token: verifyToken }
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);
  assert.equal(verified.body.email, 'recover04@example.com');

  const verifyAgain = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/email/verify', body: { token: verifyToken }
  });
  assert.equal(verifyAgain.status, 409);

  const secondSession = await login(fx.app, 'recover04', 'old-password');
  assert.equal(secondSession.status, 200);
  const resetRequest = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/password/request', body: { email: 'recover04@example.com' }
  });
  assert.equal(resetRequest.status, 202);
  assert.equal(fx.mails.length, 2);
  const resetToken = tokenFromMail(fx.mails[1], 'reset');

  const reset = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/password/reset', body: { token: resetToken, password: 'new-password-04' }
  });
  assert.equal(reset.status, 200);
  assert.equal(fx.authRuntime.tokenMap.has(memberLogin.body.token), false);
  assert.equal(fx.authRuntime.tokenMap.has(secondSession.body.token), false);

  const resetAgain = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/password/reset', body: { token: resetToken, password: 'another-password' }
  });
  assert.equal(resetAgain.status, 409);
  assert.equal((await login(fx.app, 'recover04', 'old-password')).status, 401);
  assert.equal((await login(fx.app, 'recover04', 'new-password-04')).status, 200);

  const mailCount = fx.mails.length;
  const unknown = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/password/request', body: { email: 'nobody@example.com' }
  });
  assert.equal(unknown.status, 202);
  assert.equal(fx.mails.length, mailCount);
});

test('email verification never pretends to send when delivery is unavailable', async t => {
  const fx = fixture(t, { mailConfigured: false });
  const loginResult = await login(fx.app, 'choushiyiguai', 'owner-password');
  assert.equal(loginResult.status, 200);
  await request(fx.app, {
    method: 'PATCH', requestPath: '/api/member/profile', token: loginResult.body.token,
    body: { displayName: 'Owner', email: 'owner@example.com' }
  });
  const result = await request(fx.app, { method: 'POST', requestPath: '/api/account-recovery/email/request', token: loginResult.body.token });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'MAIL_UNAVAILABLE');
  assert.equal(fx.recoveryStore.emailStatus('choushiyiguai', 'owner@example.com').verified, false);
});

test('native passkey verification checks signature, rp hash and monotonic counter', t => {
  const fx = fixture(t);
  const keys = createTestPasskey(fx.passkeyStore, 'choushiyiguai');
  assert.equal(fx.passkeyStore.listCredentials('choushiyiguai').length, 1);

  const assertion = signAssertion(fx.passkeyStore, 'choushiyiguai', keys, 1);
  const verified = fx.passkeyStore.finishAuthentication('choushiyiguai', assertion);
  assert.equal(verified.signCount, 1);
  assert.ok(verified.lastUsedAt);

  const replayCounter = signAssertion(fx.passkeyStore, 'choushiyiguai', keys, 1);
  assert.throws(
    () => fx.passkeyStore.finishAuthentication('choushiyiguai', replayCounter),
    error => error?.code === 'FORBIDDEN' && /计数器/.test(error.message)
  );

  const badRp = fx.passkeyStore.beginAuthentication('choushiyiguai', { rpId: 'localhost', origin: 'http://localhost' });
  const badClient = clientData('webauthn.get', badRp.challenge, 'http://localhost');
  const wrongHash = crypto.createHash('sha256').update('evil.example').digest();
  const count = Buffer.alloc(4); count.writeUInt32BE(2);
  const authData = Buffer.concat([wrongHash, Buffer.from([0x01]), count]);
  const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(badClient).digest()]), keys.privateKey);
  assert.throws(
    () => fx.passkeyStore.finishAuthentication('choushiyiguai', {
      credentialId: keys.credentialId,
      authenticatorData: b64url(authData), signature: b64url(signature), clientDataJSON: b64url(badClient),
      challenge: badRp.challenge, origin: 'http://localhost', rpId: 'localhost'
    }),
    error => error?.code === 'FORBIDDEN' && /RP/.test(error.message)
  );
});

test('purging passkey data also invalidates outstanding registration challenges', t => {
  const fx = fixture(t);
  fx.accountStore.createAccount({ username: 'challenge04', password: 'challenge-password', active: true });
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const options = fx.passkeyStore.beginRegistration('challenge04', { rpId: 'localhost', origin: 'http://localhost', displayName: 'Challenge' });
  assert.equal(fx.passkeyStore.purgeUser('challenge04'), 0);
  const client = clientData('webauthn.create', options.challenge, 'http://localhost');
  assert.throws(() => fx.passkeyStore.finishRegistration('challenge04', {
    credentialId: 'challenge-credential',
    publicKey: b64url(keys.publicKey.export({ format: 'der', type: 'spki' })),
    algorithm: -7,
    clientDataJSON: b64url(client), challenge: options.challenge, origin: 'http://localhost', rpId: 'localhost'
  }), error => ['NOT_FOUND', 'CONFLICT'].includes(error?.code));
});

test('co-manager can govern delegated team but cannot replace the primary manager policy', async t => {
  const fx = fixture(t);
  const primary = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'primary04', password: 'primary-password', displayName: '主管 A', role: 'manager'
  });
  fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'coadmin04', password: 'coadmin-password', displayName: '主管 B', role: 'manager'
  });
  fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'outsider04', password: 'outsider-password', displayName: '主管 C', role: 'manager'
  });
  fx.memberStore.createManagedMember(primary.username, {
    username: 'delegated04', password: 'member-password', displayName: '团队成员', role: 'member'
  });
  const team = fx.collaborationStore.ensureTeam(primary.username, primary.displayName);

  const primaryLogin = await login(fx.app, 'primary04', 'primary-password');
  const coLogin = await login(fx.app, 'coadmin04', 'coadmin-password');
  const outsiderLogin = await login(fx.app, 'outsider04', 'outsider-password');
  assert.equal(primaryLogin.status, 200);
  assert.equal(coLogin.status, 200);

  const delegated = await request(fx.app, {
    method: 'PUT', requestPath: `/api/team-admin/teams/${team.id}/co-managers`, token: primaryLogin.body.token,
    body: { usernames: ['coadmin04'] }
  });
  assert.equal(delegated.status, 200);
  assert.deepEqual(delegated.body.team.coManagers, ['coadmin04']);

  const coTeams = await request(fx.app, { requestPath: '/api/team-admin/teams', token: coLogin.body.token });
  assert.equal(coTeams.status, 200);
  assert.ok(coTeams.body.teams.some(item => item.team.id === team.id));

  const scopes = await request(fx.app, {
    method: 'PUT', requestPath: `/api/team-admin/teams/${team.id}/members/delegated04/api-scopes`, token: coLogin.body.token,
    body: { scopes: ['text', 'image'] }
  });
  assert.equal(scopes.status, 200);
  assert.deepEqual([...scopes.body.member.apiScopes].sort(), ['image', 'text']);
  assert.equal(scopes.body.changedBy, 'coadmin04');

  const governance = await request(fx.app, {
    method: 'PATCH', requestPath: `/api/team-admin/teams/${team.id}/governance`, token: coLogin.body.token,
    body: { monthlyTokenLimit: 12345 }
  });
  assert.equal(governance.status, 200);
  assert.equal(governance.body.governance.monthlyTokenLimit, 12345);

  const forbidden = await request(fx.app, {
    method: 'PUT', requestPath: `/api/team-admin/teams/${team.id}/members/delegated04/api-scopes`, token: outsiderLogin.body.token,
    body: { scopes: ['tts'] }
  });
  assert.equal(forbidden.status, 403);

  const cannotDelegate = await request(fx.app, {
    method: 'PUT', requestPath: `/api/team-admin/teams/${team.id}/co-managers`, token: coLogin.body.token,
    body: { usernames: ['outsider04'] }
  });
  assert.equal(cannotDelegate.status, 403);
});

test('permanent purge removes credentials and profile while retaining usage and preventing resurrection', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', {
    username: 'purgeManager', password: 'manager-password', displayName: '删除主管', role: 'manager'
  });
  fx.memberStore.createManagedMember(manager.username, {
    username: 'purge04', password: 'purge-password', displayName: '待删除成员', role: 'member', apiEnabled: true
  });
  fx.collaborationStore.ensureTeam(manager.username, manager.displayName);
  fx.usageStore.record({
    username: 'purge04', billedTo: manager.username, teamOwner: manager.username,
    feature: 'chat', provider: 'test', model: 'test-model', status: 'success',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    metadata: { usageEstimated: false }
  });
  fx.profileStore.update('purge04', { email: 'purge04@example.com', phone: '+81 90 1234 5678', bio: 'private profile' });
  createTestPasskey(fx.passkeyStore, 'purge04');
  const mfaStore = createMfaStore({ systemDir: fx.systemDir });
  const setup = mfaStore.beginSetup('purge04');
  const code = hotp(setup.secret, Math.floor(Date.now() / 1000 / 30));
  assert.equal(mfaStore.enable('purge04', code).status.enabled, true);

  const managerLogin = await login(fx.app, 'purgeManager', 'manager-password');
  const ownerLogin = await login(fx.app, 'choushiyiguai', 'owner-password');
  const memberLogin = await login(fx.app, 'purge04', 'purge-password', { mfaCode: hotp(setup.secret, Math.floor(Date.now() / 1000 / 30)) });
  assert.equal(memberLogin.status, 200);

  const archived = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/purge04/archive', token: managerLogin.body.token,
    body: { reason: '离开团队' }
  });
  assert.equal(archived.status, 200);
  assert.equal(fx.accountStore.getAccount('purge04').active, false);

  const wrongConfirm = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/purge/purge04', token: ownerLogin.body.token,
    body: { currentPassword: 'owner-password', confirmation: 'wrong', reason: 'requested deletion' }
  });
  assert.equal(wrongConfirm.status, 400);

  const purged = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/purge/purge04', token: ownerLogin.body.token,
    body: { currentPassword: 'owner-password', confirmation: 'purge04', reason: 'requested deletion' }
  });
  assert.equal(purged.status, 200);
  assert.equal(purged.body.deleted, true);
  assert.equal(purged.body.auditRetained, true);
  assert.equal(fx.recoveryStore.isDeleted('purge04'), true);
  assert.equal(fx.passkeyStore.listCredentials('purge04').length, 0);
  assert.equal(createMfaStore({ systemDir: fx.systemDir }).status('purge04').enabled, false);
  assert.equal(fx.profileStore.get('purge04').email, null);
  const redacted = fx.memberStore.getMember('purge04');
  assert.equal(redacted.displayName, '已删除用户');
  assert.equal(redacted.boundTo, null);
  assert.deepEqual(redacted.apiScopes, []);
  assert.equal(fx.accountStore.getAccount('purge04').active, false);
  assert.equal(fx.usageStore.summaryForUser('purge04', 'month').totalTokens, 15);
  assert.equal((await login(fx.app, 'purge04', 'purge-password')).status, 401);

  const restoreBlocked = await request(fx.app, {
    method: 'POST', requestPath: '/api/member/team/members/purge04/restore', token: ownerLogin.body.token
  });
  assert.equal(restoreBlocked.status, 409);
  assert.equal(restoreBlocked.body.code, 'ACCOUNT_PERMANENTLY_DELETED');

  const purgeAgain = await request(fx.app, {
    method: 'POST', requestPath: '/api/account-recovery/purge/purge04', token: ownerLogin.body.token,
    body: { currentPassword: 'owner-password', confirmation: 'purge04' }
  });
  assert.equal(purgeAgain.status, 409);
  assert.equal(purgeAgain.body.code, 'ACCOUNT_PERMANENTLY_DELETED');
});
