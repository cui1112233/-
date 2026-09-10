const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { governanceStoreForMemberStore, quotaState } = require('../lib/team-governance-store');
const { devGrantActor } = require('../lib/dev-permissions');
const { revokePersistentSessionsForUser } = require('../lib/session-store');

const API_SCOPES = ['text', 'image', 'tts', 'video'];

function createTeamAdminRouter({ memberStore, usageStore, accountStore, authRuntime } = {}) {
  if (!memberStore || !usageStore || !accountStore || !authRuntime) throw new Error('team admin dependencies are required');
  const router = express.Router();
  router.use(apiAuth);
  const systemDir = path.dirname(accountStore.files.audit);
  const collaborationStore = createTeamCollaborationStore({ systemDir });
  const governanceStore = governanceStoreForMemberStore(memberStore);

  function sendError(res, error) {
    const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'FORBIDDEN' ? 403 : error?.code === 'CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: error?.message || '请求失败' });
  }

  function teamAccess(username, teamId, { ownerOnly = false } = {}) {
    const self = memberStore.getMember(username);
    const team = collaborationStore.getTeam(teamId);
    if (!self || !self.active) { const error = new Error('当前账号不可用'); error.code = 'FORBIDDEN'; throw error; }
    if (!team) { const error = new Error('团队不存在'); error.code = 'NOT_FOUND'; throw error; }
    if (self.role === 'dev') return { self, team };
    if (self.role !== 'manager') { const error = new Error('当前身份没有团队管理权限'); error.code = 'FORBIDDEN'; throw error; }
    if (ownerOnly && team.managerUsername !== self.username) { const error = new Error('仅团队主负责人可执行此操作'); error.code = 'FORBIDDEN'; throw error; }
    if (team.managerUsername !== self.username && !team.coManagers?.includes(self.username)) { const error = new Error('无权管理该团队'); error.code = 'FORBIDDEN'; throw error; }
    return { self, team };
  }

  function teamMembers(team) {
    return memberStore.listMembers().filter(item => item.username === team.managerUsername || (item.role === 'member' && item.boundTo === team.managerUsername));
  }

  function memberTarget(team, username) {
    const member = memberStore.getMember(username);
    if (!member || member.role !== 'member' || member.boundTo !== team.managerUsername) {
      const error = new Error('目标成员不属于该团队'); error.code = 'FORBIDDEN'; throw error;
    }
    return member;
  }

  function revokeUserSessions(username) {
    let runtimeRemoved = 0;
    for (const [token, value] of authRuntime.tokenMap.entries()) {
      const candidate = typeof value === 'string' ? value : value?.username;
      if (candidate !== username) continue;
      authRuntime.tokenMap.delete(token);
      runtimeRemoved += 1;
    }
    return { runtime: runtimeRemoved, persistent: revokePersistentSessionsForUser(authRuntime.sessionsPath, username) };
  }

  function summary(team) {
    const manager = memberStore.getMember(team.managerUsername);
    const members = teamMembers(team);
    const usage = usageStore.summaryForTeam(team.managerUsername, 'month');
    const governance = governanceStore.get(team.managerUsername);
    return {
      team,
      manager,
      coManagers: (team.coManagers || []).map(username => memberStore.getMember(username)).filter(Boolean),
      memberCount: members.filter(item => item.role === 'member').length,
      usage,
      governance,
      quota: quotaState(usage.totalTokens, governance.monthlyTokenLimit)
    };
  }

  router.get('/teams', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) return res.status(403).json({ error: '当前身份没有团队管理权限' });
      const teams = self.role === 'dev'
        ? [collaborationStore.ensureTeam(self.username, self.displayName), ...collaborationStore.listTeams().filter(team => team.managerUsername !== self.username)]
        : collaborationStore.teamsForManager(self.username);
      return res.json({ teams: teams.map(summary) });
    } catch (error) { return sendError(res, error); }
  });

  router.put('/teams/:id/co-managers', (req, res) => {
    try {
      const { self, team } = teamAccess(req.username, req.params.id, { ownerOnly: true });
      const usernames = Array.isArray(req.body?.usernames) ? [...new Set(req.body.usernames.map(String))] : null;
      if (!usernames) return res.status(400).json({ error: '联合管理员列表不合法' });
      for (const username of usernames) {
        const member = memberStore.getMember(username);
        if (!member || !member.active || member.role !== 'manager') return res.status(400).json({ error: `@${username} 不是可用的 MANAGER` });
        if (username === team.managerUsername) return res.status(400).json({ error: '主负责人不需要重复添加为联合管理员' });
      }
      const updated = collaborationStore.setCoManagers(team.id, usernames);
      for (const username of usernames) collaborationStore.notify(username, { type: 'team.co_manager_added', title: '你被设为联合管理员', message: `你现在可以协助管理「${updated.name}」。`, metadata: { teamId: updated.id } });
      collaborationStore.notify(team.managerUsername, { type: 'team.co_managers_changed', title: '联合管理员已更新', message: `${self.displayName} 更新了「${updated.name}」的联合管理员。`, metadata: { teamId: updated.id } });
      return res.json(summary(updated));
    } catch (error) { return sendError(res, error); }
  });

  router.get('/teams/:id/members', (req, res) => {
    try {
      const { team } = teamAccess(req.username, req.params.id);
      const members = teamMembers(team);
      const month = usageStore.summariesForUsers(members.map(item => item.username), 'month', { teamOwner: team.managerUsername });
      return res.json({
        team,
        members: members.map(member => ({ ...member, usage: { month: month[member.username] } }))
      });
    } catch (error) { return sendError(res, error); }
  });

  router.patch('/teams/:id/governance', (req, res) => {
    try {
      const { team } = teamAccess(req.username, req.params.id);
      governanceStore.update(team.managerUsername, { monthlyTokenLimit: req.body?.monthlyTokenLimit }, req.username);
      return res.json(summary(team));
    } catch (error) { return sendError(res, error); }
  });

  router.put('/teams/:id/members/:username/api-scopes', (req, res) => {
    try {
      const { team } = teamAccess(req.username, req.params.id);
      const target = memberTarget(team, req.params.username);
      if (!target.active) return res.status(409).json({ error: '成员账号已停用' });
      const scopes = Array.isArray(req.body?.scopes) ? [...new Set(req.body.scopes)] : null;
      if (!scopes || scopes.some(scope => !API_SCOPES.includes(scope))) return res.status(400).json({ error: 'API scopes 不合法' });
      for (const scope of ['*', ...API_SCOPES]) memberStore.setApiAccess(team.managerUsername, target.username, false, scope);
      for (const scope of scopes) memberStore.setApiAccess(team.managerUsername, target.username, true, scope);
      collaborationStore.notify(target.username, { type: 'api.scopes_changed', title: 'AI 能力权限已更新', message: scopes.length ? `联合管理团队将你的能力调整为：${scopes.join(' / ')}` : '当前所有团队 AI 能力均已暂停。' });
      return res.json({ member: memberStore.getMember(target.username), changedBy: req.username });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/teams/:id/members/:username/status', (req, res) => {
    try {
      const { team } = teamAccess(req.username, req.params.id);
      const target = memberTarget(team, req.params.username);
      if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: '账号状态不合法' });
      accountStore.setActive(devGrantActor(accountStore, req.username), target.username, req.body.active);
      const revoked = req.body.active ? { runtime: 0, persistent: 0 } : revokeUserSessions(target.username);
      collaborationStore.notify(target.username, { type: req.body.active ? 'account.restored' : 'account.disabled', title: req.body.active ? '账号已恢复' : '账号已停用', message: `${req.username} 通过团队联合管理权限更新了你的账号状态。` });
      return res.json({ member: memberStore.getMember(target.username), revoked, changedBy: req.username });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/teams/:id/members/:username/reset-password', (req, res) => {
    try {
      const { team } = teamAccess(req.username, req.params.id);
      const target = memberTarget(team, req.params.username);
      if (typeof req.body?.password !== 'string' || req.body.password.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' });
      accountStore.resetPassword(devGrantActor(accountStore, req.username), target.username, req.body.password);
      const revoked = revokeUserSessions(target.username);
      collaborationStore.notify(target.username, { type: 'security.password_reset', title: '密码已被团队管理员重置', message: `${req.username} 使用联合管理权限重置了你的登录密码。` });
      return res.json({ changed: true, revoked, changedBy: req.username });
    } catch (error) { return sendError(res, error); }
  });

  return router;
}

module.exports = { createTeamAdminRouter };
