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
const { createAuthRouter } = require('../routes/auth');
const { createAccountAdminRouter } = require('../routes/account-admin');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            try { resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }); }
            catch (error) { reject(error); }
          });
        });
      });
      req.once('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-account-admin-'));
  const systemDir = path.join(root, 'system');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'owner-password', legacyuser: 'legacy-password' });
  const authRuntime = createAuthRuntime({ accountStore, tokenMap: new Map(), sessionsPath: path.join(root, 'sessions.json') });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const app = express();
  app.locals.authRuntime = authRuntime;
  app.use(express.json());
  app.use('/api/login', createAuthRouter(authRuntime, memberStore));
  app.use('/api/account-admin', createAccountAdminRouter({ memberStore, usageStore, accountStore, authRuntime }));
  return { app, memberStore, usageStore };
}

async function login(app, username, password) {
  const response = await request(app, { method: 'POST', requestPath: '/api/login', body: { username, password } });
  assert.equal(response.status, 200);
  return response.body.token;
}

test('DEV account directory includes ownership, online state, API host, and monthly usage without keys', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', { username: 'manager-admin', password: 'password01', role: 'manager' });
  const member = fx.memberStore.createManagedMember(manager.username, { username: 'member-admin', password: 'password01' });
  fx.usageStore.record({ username: member.username, billedTo: manager.username, teamOwner: manager.username, feature: 'chat', usage: { total_tokens: 42 } });
  const token = await login(fx.app, 'choushiyiguai', 'owner-password');
  const response = await request(fx.app, { requestPath: '/api/account-admin/accounts', token });
  assert.equal(response.status, 200);
  const row = response.body.accounts.find(account => account.username === member.username);
  assert.equal(row.teamOwner.username, manager.username);
  assert.equal(row.presence.online, false);
  assert.equal(row.usage.month.totalTokens, 42);
  assert.equal('apiKey' in row, false);
});

test('transfer preview and commit clear old scopes and notify the member and both team owners', async t => {
  const fx = fixture(t);
  const source = fx.memberStore.createManagedMember('choushiyiguai', { username: 'manager-source', password: 'password01', role: 'manager' });
  const destination = fx.memberStore.createManagedMember('choushiyiguai', { username: 'manager-destination', password: 'password01', role: 'manager' });
  const member = fx.memberStore.createManagedMember(source.username, { username: 'member-transfer-api', password: 'password01', monthlyTokenLimit: 120 });
  fx.memberStore.setApiAccess(source.username, member.username, true, 'text');
  const token = await login(fx.app, 'choushiyiguai', 'owner-password');

  const preview = await request(fx.app, { requestPath: `/api/account-admin/accounts/${member.username}/transfer-preview?boundTo=${destination.username}`, token });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.from.owner.username, source.username);
  assert.equal(preview.body.preview.to.owner.username, destination.username);
  assert.deepEqual(preview.body.preview.oldScopes, ['text']);
  assert.equal(preview.body.preview.requiresReauthorization, true);
  assert.equal('apiKey' in preview.body.preview, false);

  const moved = await request(fx.app, { method: 'POST', requestPath: `/api/account-admin/accounts/${member.username}/transfer`, token, body: { boundTo: destination.username, resetMonthlyTokenLimit: true } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.member.boundTo, destination.username);
  assert.deepEqual(moved.body.member.apiScopes, []);
  assert.equal(moved.body.member.monthlyTokenLimit, null);
  assert.deepEqual(moved.body.clearedScopes, ['text']);
  assert.deepEqual(moved.body.notifications.recipients.sort(), [member.username, source.username, destination.username].sort());
});

test('MANAGER and MEMBER cannot access account-admin routes', async t => {
  const fx = fixture(t);
  const manager = fx.memberStore.createManagedMember('choushiyiguai', { username: 'manager-forbidden', password: 'password01', role: 'manager' });
  fx.memberStore.createManagedMember(manager.username, { username: 'member-forbidden', password: 'password01' });
  const managerToken = await login(fx.app, manager.username, 'password01');
  const memberToken = await login(fx.app, 'member-forbidden', 'password01');
  assert.equal((await request(fx.app, { requestPath: '/api/account-admin/accounts', token: managerToken })).status, 403);
  assert.equal((await request(fx.app, { requestPath: '/api/account-admin/accounts', token: memberToken })).status, 403);
});
