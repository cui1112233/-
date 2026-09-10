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
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { createAuthRouter } = require('../routes/auth');
const { createMemberCenterRouter } = require('../routes/member-center');
const { createTeamAdminRouter } = require('../routes/team-admin');
const { createScriptVideoRouter } = require('../routes/script-video');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? '' : JSON.stringify(body);
    let settled = false;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      if (!server.listening) return callback(value);
      server.close(() => callback(value));
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
          ...(token ? { Authorization: `Bearer ${token}` } : {})
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

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-team-video-scope-'));
  const systemDir = path.join(root, 'system');
  const avatarsDir = path.join(root, 'avatars');
  fs.mkdirSync(systemDir, { recursive: true });
  fs.mkdirSync(avatarsDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'owner-password' });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(root, 'sessions.json')
  });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const collaborationStore = createTeamCollaborationStore({ systemDir });

  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'video_manager',
    password: 'manager-password',
    displayName: '视频主管',
    role: 'manager'
  });
  const team = collaborationStore.ensureTeam(manager.username, manager.displayName);

  authRuntime.tokenMap.set('owner-token', { username: 'choushiyiguai' });
  authRuntime.tokenMap.set('manager-token', { username: manager.username });

  let providerCalls = 0;
  const submitVideo = async () => {
    providerCalls += 1;
    return { statusCode: 200, text: JSON.stringify({ task_id: `video-task-${providerCalls}` }) };
  };

  const app = express();
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = memberStore;
  app.use(express.json());
  app.use('/api/login', createAuthRouter(authRuntime, memberStore));
  app.use('/api/member', createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore }));
  app.use('/api/team-admin', createTeamAdminRouter({ memberStore, usageStore, accountStore, authRuntime }));
  app.use('/api/script-video', createScriptVideoRouter({
    memberStore,
    configReader: () => ({ video: { apiKey: 'test-video-key' } }),
    submit: submitVideo
  }));

  return { app, authRuntime, memberStore, collaborationStore, manager, team, providerCalls: () => providerCalls };
}

test('team invitation accepts video and persists it when the member joins', async t => {
  const fx = fixture(t);
  const created = fx.collaborationStore.createInvite({
    teamId: fx.team.id,
    managerUsername: fx.manager.username,
    createdBy: fx.manager.username,
    apiScopes: ['video']
  });

  assert.deepEqual(created.invite.apiScopes, ['video']);

  const joined = await request(fx.app, {
    method: 'POST',
    requestPath: `/api/login/invite/${created.token}`,
    body: { username: 'video_invitee', password: 'invite-password', displayName: '视频组员' }
  });

  assert.equal(joined.status, 201);
  assert.deepEqual(joined.body.member.apiScopes, ['video']);
  assert.equal(fx.memberStore.canUseApi('video_invitee', 'video'), true);
});

test('member creation keeps video while filtering unsupported scopes', async t => {
  const fx = fixture(t);
  const created = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/member/team/members',
    token: 'manager-token',
    body: {
      username: 'video_created',
      password: 'created-password',
      displayName: '新建视频组员',
      apiScopes: ['video', 'unsupported']
    }
  });

  assert.equal(created.status, 201);
  assert.deepEqual(created.body.member.apiScopes, ['video']);
});

test('member scope management replaces wildcard access with video', async t => {
  const fx = fixture(t);
  const member = fx.memberStore.createManagedMember(fx.manager.username, {
    username: 'video_managed',
    password: 'managed-password',
    apiEnabled: true
  });
  assert.deepEqual(member.apiScopes, ['*']);

  const updated = await request(fx.app, {
    method: 'PUT',
    requestPath: `/api/member/team/members/${member.username}/api-scopes`,
    token: 'manager-token',
    body: { scopes: ['video'] }
  });

  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.member.apiScopes, ['video']);
});

test('joint team administration accepts and persists video scope', async t => {
  const fx = fixture(t);
  const member = fx.memberStore.createManagedMember(fx.manager.username, {
    username: 'video_delegated',
    password: 'delegated-password',
    apiEnabled: true
  });

  const updated = await request(fx.app, {
    method: 'PUT',
    requestPath: `/api/team-admin/teams/${fx.team.id}/members/${member.username}/api-scopes`,
    token: 'owner-token',
    body: { scopes: ['video'] }
  });

  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.member.apiScopes, ['video']);
  assert.equal(updated.body.changedBy, 'choushiyiguai');
});

test('video creation rejects a MEMBER without video scope before calling the provider', async t => {
  const fx = fixture(t);
  const member = fx.memberStore.createManagedMember(fx.manager.username, {
    username: 'video_denied',
    password: 'denied-password'
  });
  fx.authRuntime.tokenMap.set('denied-token', { username: member.username });

  const response = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/script-video',
    token: 'denied-token',
    body: { prompt: '雨夜里的追车镜头' }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: '暂无视频生成权限' });
  assert.equal(fx.providerCalls(), 0);
});

test('video creation allows MEMBER accounts with video or wildcard scope', async t => {
  const fx = fixture(t);
  const cases = [
    { username: 'video_allowed', scope: 'video', token: 'video-token' },
    { username: 'video_wildcard', scope: '*', token: 'wildcard-token' }
  ];

  for (const item of cases) {
    const member = fx.memberStore.createManagedMember(fx.manager.username, {
      username: item.username,
      password: `${item.username}-password`
    });
    fx.memberStore.setApiAccess(fx.manager.username, member.username, true, item.scope);
    fx.authRuntime.tokenMap.set(item.token, { username: member.username });

    const response = await request(fx.app, {
      method: 'POST',
      requestPath: '/api/script-video',
      token: item.token,
      body: { prompt: `授权范围 ${item.scope} 的视频镜头` }
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.ok, true);
    assert.match(response.body.taskId, /^video-task-/);
  }

  assert.equal(fx.providerCalls(), cases.length);
});
