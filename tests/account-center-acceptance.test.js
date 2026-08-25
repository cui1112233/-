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
const { resolveApiAccess } = require('../lib/api-access');
const { createAuthRouter } = require('../routes/auth');
const { createMemberCenterRouter } = require('../routes/member-center');
const configRouterModule = require('../routes/config');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
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
          ...(token ? { Authorization: `Bearer ${token}` } : {})
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

function modelConfig(label) {
  return {
    provider: 'custom',
    baseUrl: `https://${label}.example.invalid/v1`,
    model: `${label}-text-model`,
    apiKey: `${label}-secret-key`,
    image: {
      mode: 'openai_compatible',
      provider: 'openai_compatible',
      displayName: '',
      baseUrl: `https://${label}-image.example.invalid/v1`,
      model: `${label}-image-model`,
      apiKey: `${label}-image-secret-key`
    },
    pet: {
      id: 'stacky',
      displayName: 'CM',
      description: 'CM，前贴的桌面宠物。',
      spriteVersionNumber: 2,
      spritesheetPath: '/pets/stacky/spritesheet.webp'
    },
    tts: { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10 }
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-account-center-acceptance-'));
  const systemDir = path.join(root, 'system');
  const avatarsDir = path.join(root, 'avatars');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({
    choushiyiguai: 'owner-password',
    legacyuser: 'legacy-password'
  });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(root, 'sessions.json')
  });
  const memberStore = createMemberStore({ systemDir, accountStore });
  const usageStore = createUsageStore({ systemDir });
  const configs = new Map();

  const app = express();
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = memberStore;
  app.locals.usageStore = usageStore;
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/login', createAuthRouter(authRuntime, memberStore));
  app.use('/api/member', createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore }));
  app.use('/api/config', configRouterModule.createConfigRouter({
    configReader(username) {
      return structuredClone(configs.get(username) || modelConfig(username));
    },
    configWriter(username, config) {
      configs.set(username, structuredClone(config));
    }
  }));

  return { app, root, systemDir, avatarsDir, accountStore, authRuntime, memberStore, usageStore, configs };
}

async function login(app, username, password, remember = false) {
  const response = await request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password, remember }
  });
  return response;
}

async function createManaged(app, token, body) {
  return request(app, {
    method: 'POST',
    requestPath: '/api/member/team/members',
    token,
    body
  });
}

test('account center acceptance: team, API sharing, usage, transfer, profile and security work together', async t => {
  const fx = fixture(t);

  const ownerLogin = await login(fx.app, 'choushiyiguai', 'owner-password');
  assert.equal(ownerLogin.status, 200);
  const ownerToken = ownerLogin.body.token;
  assert.equal(ownerLogin.body.role, 'dev');

  const managerAResponse = await createManaged(fx.app, ownerToken, {
    username: 'managerA',
    password: 'manager-a-password',
    displayName: '甲组主管',
    role: 'manager'
  });
  assert.equal(managerAResponse.status, 201);
  assert.equal(managerAResponse.body.member.role, 'manager');

  const managerBResponse = await createManaged(fx.app, ownerToken, {
    username: 'managerB',
    password: 'manager-b-password',
    displayName: '乙组主管',
    role: 'manager'
  });
  assert.equal(managerBResponse.status, 201);

  fx.configs.set('managerA', modelConfig('manager-a'));
  fx.configs.set('managerB', modelConfig('manager-b'));
  fx.configs.set('member01', modelConfig('member-own'));

  const managerALogin = await login(fx.app, 'managerA', 'manager-a-password');
  assert.equal(managerALogin.status, 200);
  const managerAToken = managerALogin.body.token;

  const memberResponse = await createManaged(fx.app, managerAToken, {
    username: 'member01',
    password: 'member-old-password',
    displayName: '小林',
    role: 'dev',
    boundTo: 'managerB',
    apiEnabled: true,
    monthlyTokenLimit: 1000
  });
  assert.equal(memberResponse.status, 201);
  assert.equal(memberResponse.body.member.role, 'member');
  assert.equal(memberResponse.body.member.boundTo, 'managerA');
  assert.equal(memberResponse.body.member.apiEnabled, true);

  const managerBLogin = await login(fx.app, 'managerB', 'manager-b-password');
  assert.equal(managerBLogin.status, 200);
  const managerBToken = managerBLogin.body.token;

  const crossTeamToggle = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/member/team/members/member01/api',
    token: managerBToken,
    body: { enabled: false }
  });
  assert.equal(crossTeamToggle.status, 403);

  const memberFirstLogin = await login(fx.app, 'member01', 'member-old-password', true);
  assert.equal(memberFirstLogin.status, 200);
  const memberFirstToken = memberFirstLogin.body.token;

  const managedConfig = await request(fx.app, {
    requestPath: '/api/config',
    token: memberFirstToken
  });
  assert.equal(managedConfig.status, 200);
  assert.equal(managedConfig.body.canManageApi, false);
  assert.equal(managedConfig.body.managedBy, 'managerA');
  assert.equal(managedConfig.body.hasApiKey, false);
  assert.equal(managedConfig.body.baseUrl, '');
  assert.equal(managedConfig.body.model, '');
  assert.equal(managedConfig.body.image.hasApiKey, false);
  assert.equal(managedConfig.body.image.baseUrl, '');
  const managedJson = JSON.stringify(managedConfig.body);
  assert.equal(managedJson.includes('manager-a-secret-key'), false);
  assert.equal(managedJson.includes('member-own-secret-key'), false);

  const beforeMemberConfig = structuredClone(fx.configs.get('member01'));
  const memberConfigWrite = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/config',
    token: memberFirstToken,
    body: {
      provider: 'custom',
      baseUrl: 'https://malicious-member.example.invalid/v1',
      model: 'malicious-model',
      apiKey: 'malicious-key',
      image: {
        baseUrl: 'https://malicious-image.example.invalid/v1',
        model: 'malicious-image-model',
        apiKey: 'malicious-image-key'
      },
      tts: { voice: 'zh-CN-XiaoxiaoNeural', style: 'friendly', speed: 1.2, pitch: 0 }
    }
  });
  assert.equal(memberConfigWrite.status, 200);
  assert.equal(memberConfigWrite.body.canManageApi, false);
  const afterMemberConfig = fx.configs.get('member01');
  assert.equal(afterMemberConfig.baseUrl, beforeMemberConfig.baseUrl);
  assert.equal(afterMemberConfig.model, beforeMemberConfig.model);
  assert.equal(afterMemberConfig.apiKey, beforeMemberConfig.apiKey);
  assert.equal(afterMemberConfig.image.apiKey, beforeMemberConfig.image.apiKey);
  assert.equal(afterMemberConfig.tts.style, 'friendly');

  let access = resolveApiAccess({
    accountStore: fx.accountStore,
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: 'member01',
    configReader: username => fx.configs.get(username)
  });
  assert.equal(access.billedTo, 'managerA');
  assert.equal(access.teamOwner, 'managerA');
  assert.equal(access.config.apiKey, 'manager-a-secret-key');

  fx.usageStore.record({
    username: 'member01',
    billedTo: 'managerA',
    teamOwner: 'managerA',
    feature: 'agent',
    provider: 'custom',
    model: 'manager-a-text-model',
    usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
    metadata: { usageEstimated: false }
  });

  const memberUsageA = await request(fx.app, { requestPath: '/api/member/me', token: memberFirstToken });
  assert.equal(memberUsageA.status, 200);
  assert.equal(memberUsageA.body.usage.month.totalTokens, 120);

  const managerATeamBeforeTransfer = await request(fx.app, { requestPath: '/api/member/team', token: managerAToken });
  const memberForA = managerATeamBeforeTransfer.body.members.find(item => item.username === 'member01');
  assert.equal(memberForA.usage.month.totalTokens, 120);

  const transfer = await request(fx.app, {
    method: 'PATCH',
    requestPath: '/api/member/team/members/member01',
    token: ownerToken,
    body: { role: 'member', boundTo: 'managerB', monthlyTokenLimit: 1000 }
  });
  assert.equal(transfer.status, 200);
  assert.equal(transfer.body.member.boundTo, 'managerB');
  assert.equal(transfer.body.member.apiEnabled, true);

  const oldManagerUsageAfterTransfer = await request(fx.app, {
    requestPath: '/api/member/team/members/member01/usage',
    token: managerAToken
  });
  assert.equal(oldManagerUsageAfterTransfer.status, 403);

  const managerBTeamAfterTransfer = await request(fx.app, { requestPath: '/api/member/team', token: managerBToken });
  const memberForBInitially = managerBTeamAfterTransfer.body.members.find(item => item.username === 'member01');
  assert.equal(memberForBInitially.usage.month.totalTokens, 0, 'old team usage must not move to the new manager');

  access = resolveApiAccess({
    accountStore: fx.accountStore,
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: 'member01',
    configReader: username => fx.configs.get(username)
  });
  assert.equal(access.billedTo, 'managerB');
  assert.equal(access.teamOwner, 'managerB');
  assert.equal(access.config.apiKey, 'manager-b-secret-key');

  fx.usageStore.record({
    username: 'member01',
    billedTo: 'managerB',
    teamOwner: 'managerB',
    feature: 'chat',
    provider: 'custom',
    model: 'manager-b-text-model',
    usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
    metadata: { usageEstimated: false }
  });

  const managerBUsage = await request(fx.app, {
    requestPath: '/api/member/team/members/member01/usage',
    token: managerBToken
  });
  assert.equal(managerBUsage.status, 200);
  assert.equal(managerBUsage.body.month.totalTokens, 80);
  assert.equal(managerBUsage.body.recent.length, 1);
  assert.equal(managerBUsage.body.recent[0].teamOwner, 'managerB');

  const memberUsageAfterTransfer = await request(fx.app, { requestPath: '/api/member/me', token: memberFirstToken });
  assert.equal(memberUsageAfterTransfer.body.usage.month.totalTokens, 200, 'member personal usage remains complete across transfers');

  const setQuota = await request(fx.app, {
    method: 'PATCH',
    requestPath: '/api/member/team/members/member01',
    token: ownerToken,
    body: { role: 'member', boundTo: 'managerB', monthlyTokenLimit: 200 }
  });
  assert.equal(setQuota.status, 200);
  assert.equal(setQuota.body.member.monthlyTokenLimit, 200);
  assert.throws(() => resolveApiAccess({
    accountStore: fx.accountStore,
    memberStore: fx.memberStore,
    usageStore: fx.usageStore,
    username: 'member01',
    configReader: username => fx.configs.get(username)
  }), error => error?.code === 'API_QUOTA_EXCEEDED' && error?.status === 429);

  const profile = await request(fx.app, {
    method: 'PATCH',
    requestPath: '/api/member/profile',
    token: memberFirstToken,
    body: {
      displayName: '林一',
      bio: '负责内容工作流与模型测试。',
      phone: '+81 90-1234-5678',
      email: 'lin@example.com',
      teamTitle: '内容负责人'
    }
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.member.displayName, '林一');
  assert.equal(profile.body.member.email, 'lin@example.com');
  assert.equal(profile.body.member.teamTitle, '内容负责人');

  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9Z1sAAAAASUVORK5CYII=';
  const avatar = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/member/avatar',
    token: memberFirstToken,
    body: { avatarDataUrl: onePixelPng }
  });
  assert.equal(avatar.status, 200);
  assert.equal(avatar.body.member.avatarUrl, '/user-content/avatars/member01.png');
  assert.equal(fs.existsSync(path.join(fx.avatarsDir, 'member01.png')), true);

  const profileReload = await request(fx.app, { requestPath: '/api/member/me', token: memberFirstToken });
  assert.equal(profileReload.body.member.displayName, '林一');
  assert.equal(profileReload.body.member.bio, '负责内容工作流与模型测试。');
  assert.equal(profileReload.body.member.avatarUrl, '/user-content/avatars/member01.png');

  const memberSecondLogin = await login(fx.app, 'member01', 'member-old-password', false);
  assert.equal(memberSecondLogin.status, 200);
  const memberSecondToken = memberSecondLogin.body.token;

  const securityBefore = await request(fx.app, { requestPath: '/api/member/security', token: memberSecondToken });
  assert.equal(securityBefore.status, 200);
  assert.equal(securityBefore.body.sessions.length, 2);
  assert.equal(securityBefore.body.persistentSessions.length, 0, 'remembered credential must not double-count an active runtime session');
  assert.equal(securityBefore.body.otherSessionCount, 1);

  const revokeOthers = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/member/security/sessions/revoke-others',
    token: memberSecondToken
  });
  assert.equal(revokeOthers.status, 200);
  assert.equal(revokeOthers.body.revoked.runtime, 1);
  assert.equal(revokeOthers.body.revoked.persistent, 1);

  const revokedFirstSession = await request(fx.app, { requestPath: '/api/member/me', token: memberFirstToken });
  assert.equal(revokedFirstSession.status, 401);

  const extraOldPasswordLogin = await login(fx.app, 'member01', 'member-old-password', true);
  assert.equal(extraOldPasswordLogin.status, 200);
  const extraOldToken = extraOldPasswordLogin.body.token;

  const passwordChange = await request(fx.app, {
    method: 'POST',
    requestPath: '/api/member/security/password',
    token: memberSecondToken,
    body: { currentPassword: 'member-old-password', newPassword: 'member-new-password' }
  });
  assert.equal(passwordChange.status, 200);
  assert.equal(passwordChange.body.changed, true);
  assert.ok(passwordChange.body.revoked.runtime >= 1);

  const oldPasswordLogin = await login(fx.app, 'member01', 'member-old-password');
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await login(fx.app, 'member01', 'member-new-password');
  assert.equal(newPasswordLogin.status, 200);

  const revokedExtraSession = await request(fx.app, { requestPath: '/api/member/me', token: extraOldToken });
  assert.equal(revokedExtraSession.status, 401);
  const currentStillValid = await request(fx.app, { requestPath: '/api/member/me', token: memberSecondToken });
  assert.equal(currentStillValid.status, 200);
});
