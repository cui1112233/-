const express = require('express');
const crypto = require('crypto');
const path = require('node:path');
const { createAuthRuntime, userSessions } = require('../lib/shared');
const { createPersistentSession, revokePersistentSession } = require('../lib/session-store');
const { createMfaStore } = require('../lib/mfa-store');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { createPasskeyStore } = require('../lib/passkey-store');
const { apiAuth } = require('../middleware/auth');

const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const INVITE_SCOPES = ['text', 'image', 'tts'];

function browserFromUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return ua ? '其他浏览器' : '未知浏览器';
}

function osFromUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return ua ? '其他系统' : '未知系统';
}

function maskedIp(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) return null;
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean).slice(0, 3);
    return parts.length ? `${parts.join(':')}::*` : 'IPv6';
  }
  return '未知网络';
}

function sessionMetadata(req) {
  const userAgent = req.headers['user-agent'] || '';
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || '';
  return {
    browser: browserFromUserAgent(userAgent),
    os: osFromUserAgent(userAgent),
    ipHint: maskedIp(ip)
  };
}

function requestOrigin(req) {
  const header = req.headers.origin;
  if (header) return String(header);
  return `${req.protocol}://${req.get('host')}`;
}

function requestRpId(req) {
  return String(req.hostname || req.get('host') || '').replace(/:\d+$/, '');
}

function createAuthRouter(runtime = createAuthRuntime(), memberStore, { passkeyStore: injectedPasskeyStore } = {}) {
  const router = express.Router();
  const systemDir = path.dirname(runtime.accountStore.files.audit);
  const mfaStore = createMfaStore({ systemDir });
  const collaborationStore = createTeamCollaborationStore({ systemDir });
  const passkeyStore = injectedPasskeyStore || createPasskeyStore({ systemDir });

  function sessionShape(account, effectivePermissions) {
    const member = memberStore?.getMember(account.username);
    return {
      username: account.username,
      displayName: member?.displayName || account.username,
      avatarUrl: member?.avatarUrl || null,
      role: member?.role || (account.isOwner ? 'dev' : 'member'),
      boundTo: member?.boundTo || null,
      monthlyTokenLimit: member?.monthlyTokenLimit ?? null,
      apiEnabled: member?.apiEnabled ?? account.isOwner,
      mfaEnabled: mfaStore.status(account.username).enabled,
      passkeyCount: passkeyStore.listCredentials(account.username).length,
      active: account.active,
      isOwner: account.isOwner,
      effectivePermissions
    };
  }

  function issueSession(req, res, account, { remember = true, authMethod = 'password', extra = {} } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const issuedAt = Date.now();
    const device = sessionMetadata(req);
    runtime.tokenMap.set(token, { username: account.username, issuedAt, authMethod, ...device });
    if (remember === true) {
      try {
        createPersistentSession(runtime.sessionsPath, token, account.username, REMEMBER_DURATION_MS, issuedAt, { ...device, authMethod });
      } catch {
        runtime.tokenMap.delete(token);
        return res.status(503).json({ error: '登录服务暂不可用，请稍后重试' });
      }
    }
    if (!userSessions.has(account.username)) userSessions.set(account.username, {});
    return res.json({
      token,
      authMethod,
      ...extra,
      ...sessionShape(account, runtime.accountStore.effectivePermissions(account))
    });
  }

  router.get('/invite/:token', (req, res) => {
    const invite = collaborationStore.inspectInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: '邀请不存在' });
    const manager = memberStore?.getMember(invite.managerUsername) || null;
    return res.json({ invite, manager: manager ? { username: manager.username, displayName: manager.displayName } : null });
  });

  router.post('/invite/:token', (req, res) => {
    if (!memberStore) return res.status(503).json({ error: '团队邀请服务暂不可用' });
    const { username, password, displayName } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: '登录账号需为 3-32 位字母、数字、下划线或短横线' });
    }
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' });
    const invite = collaborationStore.inspectInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: '邀请不存在' });
    if (!invite.available) return res.status(409).json({ error: invite.expired ? '邀请已过期' : '邀请已被使用' });
    const manager = memberStore.getMember(invite.managerUsername);
    if (!manager || !manager.active || !['dev', 'manager'].includes(manager.role)) return res.status(409).json({ error: '邀请所属团队当前不可用' });

    let claimed = false;
    try {
      collaborationStore.claimInvite(req.params.token, username);
      claimed = true;
      let member = memberStore.createManagedMember(manager.username, {
        username, password, displayName, role: 'member', boundTo: manager.username,
        monthlyTokenLimit: invite.monthlyTokenLimit, apiEnabled: false
      });
      for (const scope of INVITE_SCOPES) memberStore.setApiAccess(manager.username, member.username, false, scope);
      for (const scope of invite.apiScopes || []) memberStore.setApiAccess(manager.username, member.username, true, scope);
      member = memberStore.getMember(member.username);
      collaborationStore.notify(manager.username, {
        type: 'member.joined', title: '新成员已加入团队',
        message: `${member.displayName}（@${member.username}）通过邀请加入了团队。`,
        metadata: { username: member.username, teamId: invite.teamId }
      });
      collaborationStore.notify(member.username, {
        type: 'team.joined', title: `欢迎加入 ${invite.teamName}`,
        message: `你已加入 ${invite.teamName}，API 权限与月度额度已按邀请策略配置。`,
        metadata: { teamId: invite.teamId, managerUsername: manager.username }
      });
      return res.status(201).json({ member, team: collaborationStore.getTeam(invite.teamId) });
    } catch (error) {
      if (claimed) collaborationStore.releaseInviteClaim(req.params.token, username);
      const status = error?.code === 'CONFLICT' ? 409 : error?.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ error: error?.message || '接受邀请失败' });
    }
  });

  router.post('/passkey/options', (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const account = runtime.accountStore.getAccount(username);
      if (!account || !account.active) return res.status(404).json({ error: '当前账号没有可用 Passkey' });
      const options = passkeyStore.beginAuthentication(username, { rpId: requestRpId(req), origin: requestOrigin(req) });
      return res.json(options);
    } catch (error) {
      const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'FORBIDDEN' ? 403 : 400;
      return res.status(status).json({ error: error?.message || '无法开始 Passkey 登录' });
    }
  });

  router.post('/passkey/verify', (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const account = runtime.accountStore.getAccount(username);
      if (!account || !account.active) return res.status(401).json({ error: 'Passkey 登录失败' });
      passkeyStore.finishAuthentication(username, {
        ...(req.body?.credential || {}),
        challenge: req.body?.challenge,
        origin: requestOrigin(req),
        rpId: requestRpId(req)
      });
      collaborationStore.notify(username, {
        type: 'security.passkey_login', title: 'Passkey 登录成功',
        message: `${sessionMetadata(req).browser} · ${sessionMetadata(req).os} 使用 Passkey 登录了账号。`
      });
      return issueSession(req, res, account, { remember: req.body?.remember === true, authMethod: 'passkey' });
    } catch (error) {
      return res.status(error?.code === 'FORBIDDEN' ? 401 : 400).json({ error: error?.message || 'Passkey 登录失败' });
    }
  });

  router.post('/', (req, res) => {
    const { username, password, remember, mfaCode } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (!runtime.accountStore.verifyPassword(username, password)) return res.status(401).json({ error: '用户名或密码错误' });

    const account = runtime.accountStore.getAccount(username);
    if (!account || !account.active || account.pending === true) return res.status(401).json({ error: '用户名或密码错误' });

    const mfa = mfaStore.status(account.username);
    let recoveryUsed = false;
    if (mfa.enabled) {
      if (!mfaCode) return res.status(428).json({ error: '请输入 MFA 动态验证码或恢复码', code: 'MFA_REQUIRED' });
      const verified = mfaStore.verify(account.username, mfaCode);
      if (!verified.ok) return res.status(401).json({ error: 'MFA 动态验证码或恢复码不正确', code: 'MFA_INVALID' });
      recoveryUsed = verified.recoveryUsed;
    }
    if (recoveryUsed) {
      collaborationStore.notify(account.username, {
        type: 'security.recovery_code_used', title: 'MFA 恢复码已使用',
        message: '刚刚有一个一次性恢复码用于登录。若非本人操作，请立即修改密码并重新配置 MFA。'
      });
    }
    return issueSession(req, res, account, {
      remember: remember === true,
      authMethod: 'password',
      extra: { mfaRecoveryUsed: recoveryUsed }
    });
  });

  router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      runtime.tokenMap.delete(match[1]);
      revokePersistentSession(runtime.sessionsPath, match[1]);
    }
    res.status(204).end();
  });

  router.get('/session', apiAuth, (req, res) => {
    res.json(sessionShape(req.auth.account, req.auth.effectivePermissions));
  });

  return router;
}

module.exports = {
  createAuthRouter,
  REMEMBER_DURATION_MS,
  browserFromUserAgent,
  osFromUserAgent,
  maskedIp,
  sessionMetadata,
  requestOrigin,
  requestRpId
};
