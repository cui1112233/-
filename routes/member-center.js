const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { ensureDevBackendPermissions, devGrantActor } = require('../lib/dev-permissions');
const { createProfileDetailsStore } = require('../lib/profile-details-store');
const { governanceStoreForMemberStore, quotaState } = require('../lib/team-governance-store');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { createMfaStore } = require('../lib/mfa-store');
const {
  listPersistentSessionsForUser,
  revokePersistentSessionsForUser,
  persistentSessionIdForToken
} = require('../lib/session-store');

const MANAGED_API_SCOPES = ['text', 'image', 'tts'];

function sendMemberError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: error.message });
  if (error?.code === 'CONFLICT') return res.status(409).json({ error: error.message });
  return res.status(400).json({ error: error?.message || '请求不合法' });
}

function parseAvatarDataUrl(value) {
  if (typeof value !== 'string') throw new Error('请选择头像图片');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('头像仅支持 PNG、JPG 或 WebP');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('头像大小不能超过 2MB');
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice('image/'.length);
  return { buffer, extension };
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function sessionUsername(value) {
  return typeof value === 'string' ? value : value?.username;
}

function createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore } = {}) {
  if (!memberStore) throw new Error('memberStore is required');
  if (!usageStore) throw new Error('usageStore is required');
  if (!avatarsDir) throw new Error('avatarsDir is required');

  const router = express.Router();
  router.use(apiAuth);
  let profileDetailsStore = null;
  let governanceStore = null;
  let collaborationStore = null;
  let mfaStore = null;

  function getAccountStore(req) {
    const resolved = accountStore || req.app?.locals?.authRuntime?.accountStore;
    if (!resolved) throw new Error('accountStore is required');
    return resolved;
  }

  function systemDir(req) {
    return path.dirname(getAccountStore(req).files.audit);
  }

  function getProfileDetailsStore(req) {
    if (!profileDetailsStore) profileDetailsStore = createProfileDetailsStore({ systemDir: systemDir(req) });
    return profileDetailsStore;
  }

  function getGovernanceStore() {
    if (!governanceStore) governanceStore = governanceStoreForMemberStore(memberStore);
    return governanceStore;
  }

  function getCollaborationStore(req) {
    if (!collaborationStore) collaborationStore = createTeamCollaborationStore({ systemDir: systemDir(req) });
    return collaborationStore;
  }

  function getMfaStore(req) {
    if (!mfaStore) mfaStore = createMfaStore({ systemDir: systemDir(req) });
    return mfaStore;
  }

  function mergedSelf(req) {
    const member = memberStore.getMember(req.username);
    if (!member) return null;
    return { ...member, ...getProfileDetailsStore(req).get(req.username) };
  }

  function requireDev(req, res) {
    const self = memberStore.getMember(req.username);
    if (!self || self.role !== 'dev') {
      res.status(403).json({ error: '仅 DEV 可以执行此操作' });
      return null;
    }
    return self;
  }

  function manageableTarget(req, targetUsername) {
    const self = memberStore.getMember(req.username);
    const target = memberStore.getMember(targetUsername);
    if (!self || !self.active) {
      const error = new Error('当前账号不可用');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (!target) {
      const error = new Error('目标成员不存在');
      error.code = 'NOT_FOUND';
      throw error;
    }
    if (target.isOwner) {
      const error = new Error('Owner 不可被其他成员管理');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (self.role === 'dev') return { self, target };
    if (self.role === 'manager' && target.role === 'member' && target.boundTo === self.username) return { self, target };
    const error = new Error('无权管理该成员');
    error.code = 'FORBIDDEN';
    throw error;
  }

  function revokeUserSessions(req, username, keepToken = '') {
    const runtime = req.app?.locals?.authRuntime;
    if (!runtime) return { runtime: 0, persistent: 0 };
    let runtimeRemoved = 0;
    for (const [token, value] of runtime.tokenMap.entries()) {
      if (token === keepToken || sessionUsername(value) !== username) continue;
      runtime.tokenMap.delete(token);
      runtimeRemoved += 1;
    }
    const persistentRemoved = revokePersistentSessionsForUser(runtime.sessionsPath, username, keepToken);
    return { runtime: runtimeRemoved, persistent: persistentRemoved };
  }

  function revokeOtherRuntimeSessions(req) {
    return revokeUserSessions(req, req.username, bearerToken(req));
  }

  function teamPolicySummary(managerUsername) {
    if (!managerUsername) return null;
    const policy = getGovernanceStore().get(managerUsername);
    const usage = usageStore.summaryForTeam(managerUsername, 'month');
    return { ...policy, usage, quota: quotaState(usage.totalTokens, policy.monthlyTokenLimit) };
  }

  function ensureTeamForManager(req, manager) {
    if (!manager || manager.role !== 'manager') return null;
    return getCollaborationStore(req).ensureTeam(manager.username, manager.displayName);
  }

  function teamForMember(req, member) {
    if (!member) return null;
    if (member.role === 'manager') return ensureTeamForManager(req, member);
    if (member.role === 'member' && member.boundTo) {
      return ensureTeamForManager(req, memberStore.getMember(member.boundTo));
    }
    return null;
  }

  function notify(req, username, payload) {
    return getCollaborationStore(req).notify(username, payload);
  }

  router.get('/me', (req, res) => {
    try {
      const member = mergedSelf(req);
      if (!member) return res.status(404).json({ error: '账号不存在' });
      const manager = member.boundTo ? memberStore.getMember(member.boundTo) : null;
      const month = usageStore.summaryForUser(req.username, 'month');
      const teamOwner = member.role === 'manager' ? member.username : member.boundTo;
      const notifications = getCollaborationStore(req).listNotifications(req.username, 8);
      return res.json({
        member,
        manager,
        team: teamForMember(req, member),
        notificationSummary: {
          unread: notifications.filter(item => !item.readAt).length,
          recent: notifications
        },
        memberQuota: quotaState(month.totalTokens, member.monthlyTokenLimit),
        teamGovernance: teamPolicySummary(teamOwner),
        usage: {
          day: usageStore.summaryForUser(req.username, 'day'),
          month,
          recent: usageStore.recentForUser(req.username, 30)
        }
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/profile', (req, res) => {
    try {
      const member = memberStore.updateOwnProfile(req.username, { displayName: req.body?.displayName });
      const details = getProfileDetailsStore(req).update(req.username, {
        bio: req.body?.bio,
        phone: req.body?.phone,
        email: req.body?.email,
        teamTitle: req.body?.teamTitle
      });
      return res.json({ member: { ...member, ...details } });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/avatar', (req, res) => {
    try {
      const { buffer, extension } = parseAvatarDataUrl(req.body?.avatarDataUrl);
      fs.mkdirSync(avatarsDir, { recursive: true, mode: 0o700 });
      for (const ext of ['png', 'jpg', 'webp']) {
        if (ext === extension) continue;
        try { fs.unlinkSync(path.join(avatarsDir, `${req.username}.${ext}`)); } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      const fileName = `${req.username}.${extension}`;
      fs.writeFileSync(path.join(avatarsDir, fileName), buffer, { mode: 0o600 });
      const avatarUrl = `/user-content/avatars/${fileName}`;
      const member = memberStore.updateOwnProfile(req.username, { avatarUrl });
      return res.json({ member: { ...member, ...getProfileDetailsStore(req).get(req.username) } });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/security', (req, res) => {
    try {
      const runtime = req.app?.locals?.authRuntime;
      const token = bearerToken(req);
      const runtimeSessions = [];
      const activePersistentIds = new Set();
      if (runtime) {
        for (const [candidateToken, value] of runtime.tokenMap.entries()) {
          if (sessionUsername(value) !== req.username) continue;
          const persistentId = persistentSessionIdForToken(candidateToken);
          if (persistentId) activePersistentIds.add(persistentId);
          runtimeSessions.push({
            id: candidateToken.slice(0, 10),
            current: candidateToken === token,
            issuedAt: typeof value === 'object' ? value.issuedAt || null : null,
            browser: typeof value === 'object' ? value.browser || null : null,
            os: typeof value === 'object' ? value.os || null : null,
            ipHint: typeof value === 'object' ? value.ipHint || null : null
          });
        }
      }
      const persistentSessions = runtime
        ? listPersistentSessionsForUser(runtime.sessionsPath, req.username, token).filter(item => !activePersistentIds.has(item.id))
        : [];
      return res.json({
        account: mergedSelf(req),
        mfa: getMfaStore(req).status(req.username),
        sessions: runtimeSessions,
        persistentSessions,
        otherSessionCount: Math.max(0, runtimeSessions.filter(item => !item.current).length + persistentSessions.filter(item => !item.current).length)
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/password', (req, res) => {
    try {
      const currentPassword = req.body?.currentPassword;
      const newPassword = req.body?.newPassword;
      const store = getAccountStore(req);
      if (!store.verifyPassword(req.username, currentPassword)) return res.status(400).json({ error: '当前密码不正确' });
      if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' });
      if (currentPassword === newPassword) return res.status(400).json({ error: '新密码不能与当前密码相同' });
      store.resetPassword(devGrantActor(store, req.username), req.username, newPassword);
      const revoked = revokeOtherRuntimeSessions(req);
      notify(req, req.username, { type: 'security.password_changed', title: '登录密码已修改', message: '账号密码已更新，其他登录会话已退出。' });
      return res.json({ changed: true, revoked });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/sessions/revoke-others', (req, res) => {
    try {
      const revoked = revokeOtherRuntimeSessions(req);
      notify(req, req.username, { type: 'security.sessions_revoked', title: '其他设备已退出', message: '你已撤销其他设备上的登录会话。' });
      return res.json({ revoked });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/mfa/setup', (req, res) => {
    try {
      const store = getAccountStore(req);
      if (!store.verifyPassword(req.username, req.body?.currentPassword)) return res.status(400).json({ error: '当前密码不正确' });
      const account = mergedSelf(req);
      return res.json(getMfaStore(req).beginSetup(req.username, { issuer: '一战晟铭', accountLabel: account?.displayName || req.username }));
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/mfa/enable', (req, res) => {
    try {
      const result = getMfaStore(req).enable(req.username, req.body?.code);
      notify(req, req.username, { type: 'security.mfa_enabled', title: 'MFA 已启用', message: '以后登录需要动态验证码或一次性恢复码。' });
      return res.json(result);
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/mfa/disable', (req, res) => {
    try {
      const store = getAccountStore(req);
      if (!store.verifyPassword(req.username, req.body?.currentPassword)) return res.status(400).json({ error: '当前密码不正确' });
      const status = getMfaStore(req).disable(req.username, req.body?.code);
      notify(req, req.username, { type: 'security.mfa_disabled', title: 'MFA 已关闭', message: '账号登录已恢复为仅密码验证。' });
      return res.json({ status });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/security/mfa/recovery-codes', (req, res) => {
    try {
      const store = getAccountStore(req);
      if (!store.verifyPassword(req.username, req.body?.currentPassword)) return res.status(400).json({ error: '当前密码不正确' });
      return res.json(getMfaStore(req).rotateRecoveryCodes(req.username, req.body?.code));
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/notifications', (req, res) => {
    try {
      const entries = getCollaborationStore(req).listNotifications(req.username, req.query.limit);
      return res.json({ entries, unread: entries.filter(item => !item.readAt).length });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/notifications/read-all', (req, res) => {
    try {
      return res.json({ changed: getCollaborationStore(req).markAllNotificationsRead(req.username) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/notifications/:id/read', (req, res) => {
    try {
      return res.json({ notification: getCollaborationStore(req).markNotificationRead(req.username, req.params.id) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '当前身份没有团队管理权限' });
      const members = memberStore.visibleTeam(req.username);
      const usernames = members.map(item => item.username);
      const usageOptions = self.role === 'manager' ? { teamOwner: self.username } : {};
      const month = usageStore.summariesForUsers(usernames, 'month', usageOptions);
      const day = usageStore.summariesForUsers(usernames, 'day', usageOptions);
      const collab = getCollaborationStore(req);
      return res.json({
        team: self.role === 'manager' ? ensureTeamForManager(req, self) : null,
        teams: self.role === 'dev'
          ? memberStore.listMembers().filter(item => item.role === 'manager').map(manager => ensureTeamForManager(req, manager))
          : undefined,
        teamGovernance: self.role === 'manager' ? teamPolicySummary(self.username) : null,
        members: members.map(member => ({
          ...member,
          archive: collab.getArchive(member.username),
          quota: quotaState(month[member.username]?.totalTokens || 0, member.monthlyTokenLimit),
          usage: { day: day[member.username], month: month[member.username] }
        }))
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/meta', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self) return res.status(404).json({ error: '账号不存在' });
      if (self.role === 'dev') {
        const teams = memberStore.listMembers().filter(item => item.role === 'manager').map(manager => ({ team: ensureTeamForManager(req, manager), manager }));
        return res.json({ team: null, teams });
      }
      return res.json({ team: teamForMember(req, self), manager: self.role === 'member' && self.boundTo ? memberStore.getMember(self.boundTo) : self });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/team/meta/:id', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      const collab = getCollaborationStore(req);
      const team = collab.getTeam(req.params.id);
      if (!team) return res.status(404).json({ error: '团队不存在' });
      if (self?.role !== 'dev' && !(self?.role === 'manager' && self.username === team.managerUsername)) {
        return res.status(403).json({ error: '无权修改该团队' });
      }
      const updated = collab.renameTeam(team.id, req.body?.name);
      const recipients = memberStore.listMembers().filter(item => item.username === team.managerUsername || (item.role === 'member' && item.boundTo === team.managerUsername));
      for (const recipient of recipients) notify(req, recipient.username, { type: 'team.renamed', title: '团队名称已更新', message: `团队名称已修改为「${updated.name}」。`, metadata: { teamId: updated.id } });
      return res.json({ team: updated });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/invites', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '无权查看团队邀请' });
      const managerUsername = self.role === 'manager' ? self.username : String(req.query.manager || '');
      if (!managerUsername) return res.json({ invites: [] });
      const manager = memberStore.getMember(managerUsername);
      if (!manager || manager.role !== 'manager') return res.status(400).json({ error: '目标账号不是 MANAGER' });
      ensureTeamForManager(req, manager);
      return res.json({ invites: getCollaborationStore(req).listInvitesForManager(managerUsername) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/invites', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '无权创建团队邀请' });
      const managerUsername = self.role === 'manager' ? self.username : (req.body?.managerUsername || '');
      const manager = memberStore.getMember(managerUsername);
      if (!manager || !manager.active || manager.role !== 'manager') return res.status(400).json({ error: '目标账号不是可用的 MANAGER' });
      const team = ensureTeamForManager(req, manager);
      const created = getCollaborationStore(req).createInvite({
        teamId: team.id,
        managerUsername: manager.username,
        createdBy: self.username,
        expiresInHours: req.body?.expiresInHours,
        monthlyTokenLimit: req.body?.monthlyTokenLimit,
        apiScopes: req.body?.apiScopes
      });
      return res.status(201).json({ ...created, inviteUrl: `/invite/${created.token}` });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/governance', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '当前身份没有团队额度管理权限' });
      const managers = self.role === 'manager' ? [self] : memberStore.listMembers().filter(item => item.role === 'manager');
      return res.json({ teams: managers.map(manager => ({ manager, team: ensureTeamForManager(req, manager), ...teamPolicySummary(manager.username) })) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/team/governance/:username', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      const manager = memberStore.getMember(req.params.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '当前身份没有团队额度管理权限' });
      if (!manager || manager.role !== 'manager') return res.status(400).json({ error: '目标账号不是 MANAGER' });
      if (self.role === 'manager' && self.username !== manager.username) return res.status(403).json({ error: 'MANAGER 只能设置自己团队的总额度' });
      getGovernanceStore().update(manager.username, { monthlyTokenLimit: req.body?.monthlyTokenLimit }, self.username);
      return res.json({ manager, team: ensureTeamForManager(req, manager), ...teamPolicySummary(manager.username) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '当前身份没有成员创建权限' });
      const body = req.body || {};
      const requestedRole = self.role === 'manager' ? 'member' : (body.role || 'member');
      const resolvedBoundTo = self.role === 'manager' ? self.username : (body.boundTo || null);
      if (requestedRole === 'member' && body.apiEnabled === true && !resolvedBoundTo) return res.status(400).json({ error: '请先绑定 MANAGER，再开启团队 API。' });
      let member = memberStore.createManagedMember(req.username, { ...body, role: requestedRole, boundTo: resolvedBoundTo });
      if (member.role === 'dev') {
        ensureDevBackendPermissions(getAccountStore(req), member);
        member = memberStore.getMember(member.username);
      }
      if (member.role === 'manager') ensureTeamForManager(req, member);
      if (member.role === 'member' && Array.isArray(body.apiScopes)) {
        memberStore.setApiAccess(req.username, member.username, false, '*');
        for (const scope of MANAGED_API_SCOPES) memberStore.setApiAccess(req.username, member.username, false, scope);
        for (const scope of [...new Set(body.apiScopes.filter(item => MANAGED_API_SCOPES.includes(item)))]) memberStore.setApiAccess(req.username, member.username, true, scope);
        member = memberStore.getMember(member.username);
      }
      notify(req, member.username, { type: 'account.created', title: '账号已创建', message: `你的 qiantie 账号 @${member.username} 已创建。` });
      return res.status(201).json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/team/members/:username', (req, res) => {
    try {
      const before = memberStore.getMember(req.params.username);
      let member = memberStore.updateManagedMember(req.username, req.params.username, req.body || {});
      if (member.role === 'dev') {
        ensureDevBackendPermissions(getAccountStore(req), member);
        member = memberStore.getMember(member.username);
      }
      if (member.role === 'manager') ensureTeamForManager(req, member);
      notify(req, member.username, { type: 'member.updated', title: '成员资料已更新', message: '你的团队角色、绑定关系或额度设置刚刚被管理员更新。' });
      if (before?.boundTo !== member.boundTo && member.boundTo) {
        const team = teamForMember(req, member);
        notify(req, member.username, { type: 'team.transferred', title: '所属团队已变更', message: `你已转入「${team?.name || member.boundTo}」。` });
      }
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/status', (req, res) => {
    try {
      const active = req.body?.active;
      if (typeof active !== 'boolean') return res.status(400).json({ error: '账号状态不合法' });
      const { target } = manageableTarget(req, req.params.username);
      const store = getAccountStore(req);
      store.setActive(devGrantActor(store, req.username), target.username, active);
      const revoked = active ? { runtime: 0, persistent: 0 } : revokeUserSessions(req, target.username);
      notify(req, target.username, { type: active ? 'account.restored' : 'account.disabled', title: active ? '账号已恢复' : '账号已停用', message: active ? '管理员已恢复你的账号。' : '管理员已停用你的账号，现有登录会话已撤销。' });
      return res.json({ member: memberStore.getMember(target.username), revoked });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/reset-password', (req, res) => {
    try {
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' });
      const { target } = manageableTarget(req, req.params.username);
      const store = getAccountStore(req);
      store.resetPassword(devGrantActor(store, req.username), target.username, password);
      const revoked = revokeUserSessions(req, target.username);
      notify(req, target.username, { type: 'security.password_reset', title: '密码已被管理员重置', message: '你的登录密码已重置，原有登录会话已撤销。' });
      return res.json({ changed: true, member: memberStore.getMember(target.username), revoked });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/api', (req, res) => {
    try {
      const member = memberStore.setApiAccess(req.username, req.params.username, req.body?.enabled, req.body?.scope || '*');
      notify(req, member.username, { type: 'api.changed', title: 'AI 权限已更新', message: `管理员已${req.body?.enabled ? '开启' : '关闭'} ${req.body?.scope || '全部'} API 权限。` });
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.put('/team/members/:username/api-scopes', (req, res) => {
    try {
      const scopes = Array.isArray(req.body?.scopes) ? [...new Set(req.body.scopes)] : null;
      if (!scopes || scopes.some(scope => !MANAGED_API_SCOPES.includes(scope))) return res.status(400).json({ error: 'API scopes 不合法' });
      manageableTarget(req, req.params.username);
      memberStore.setApiAccess(req.username, req.params.username, false, '*');
      for (const scope of MANAGED_API_SCOPES) memberStore.setApiAccess(req.username, req.params.username, false, scope);
      for (const scope of scopes) memberStore.setApiAccess(req.username, req.params.username, true, scope);
      const member = memberStore.getMember(req.params.username);
      notify(req, member.username, { type: 'api.scopes_changed', title: 'AI 能力权限已更新', message: scopes.length ? `当前可用能力：${scopes.join(' / ')}` : '当前所有团队 AI 能力均已暂停。' });
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/archive', (req, res) => {
    try {
      const { target } = manageableTarget(req, req.params.username);
      for (const scope of ['*', ...MANAGED_API_SCOPES]) {
        try { memberStore.setApiAccess(req.username, target.username, false, scope); } catch { /* already absent */ }
      }
      const archive = getCollaborationStore(req).archiveMember(target.username, req.username, req.body?.reason);
      const store = getAccountStore(req);
      store.setActive(devGrantActor(store, req.username), target.username, false);
      const revoked = revokeUserSessions(req, target.username);
      notify(req, target.username, { type: 'account.archived', title: '账号已归档', message: '你的账号已被团队管理员归档，历史用量和审计记录会继续保留。' });
      return res.json({ member: memberStore.getMember(target.username), archive, revoked });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/restore', (req, res) => {
    try {
      const { target } = manageableTarget(req, req.params.username);
      const store = getAccountStore(req);
      store.setActive(devGrantActor(store, req.username), target.username, true);
      const archive = getCollaborationStore(req).restoreMember(target.username, req.username);
      notify(req, target.username, { type: 'account.archive_restored', title: '账号已从归档恢复', message: '账号已恢复登录。AI 权限需要管理员重新授权。' });
      return res.json({ member: memberStore.getMember(target.username), archive });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/members/:username/usage', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      const visible = new Set(memberStore.visibleTeam(req.username).map(item => item.username));
      if (!visible.has(req.params.username)) return res.status(403).json({ error: '无权查看该成员用量' });
      const usageOptions = self?.role === 'manager' ? { teamOwner: self.username } : {};
      const month = usageStore.summaryForUser(req.params.username, 'month', usageOptions);
      const target = memberStore.getMember(req.params.username);
      return res.json({
        day: usageStore.summaryForUser(req.params.username, 'day', usageOptions),
        month,
        quota: quotaState(month.totalTokens, target?.monthlyTokenLimit ?? null),
        recent: usageStore.recentForUser(req.params.username, 50, usageOptions)
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/audit', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '无权查看团队操作日志' });
      return res.json({ entries: memberStore.listAudit(req.username, req.query.limit) });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/backend-grants', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      return res.json({ grants: getAccountStore(req).listGrants() });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/backend-grants', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const store = getAccountStore(req);
      const subject = req.body?.subject;
      const target = memberStore.getMember(subject);
      if (!target || target.isOwner) return res.status(400).json({ error: '目标成员不合法' });
      const actor = devGrantActor(store, req.username);
      const grant = store.grant(actor, subject, { capability: req.body?.capability, scope: req.body?.scope || '*' });
      return res.status(201).json({ grant });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.delete('/team/backend-grants/:id', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const store = getAccountStore(req);
      const actor = devGrantActor(store, req.username);
      const grant = store.revokeGrant(actor, req.params.id);
      return res.json({ grant });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  return router;
}

module.exports = { createMemberCenterRouter, parseAvatarDataUrl, MANAGED_API_SCOPES };
