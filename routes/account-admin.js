const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { governanceStoreForMemberStore } = require('../lib/team-governance-store');
const { ensureDevBackendPermissions, revokeBackendPermissions, devGrantActor } = require('../lib/dev-permissions');

function sendError(res, error) {
  const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'FORBIDDEN' ? 403 : error?.code === 'CONFLICT' ? 409 : 400;
  return res.status(status).json({ error: error?.message || '请求失败', ...(error?.code ? { code: error.code } : {}) });
}

function runtimeUsername(value) {
  return typeof value === 'string' ? value : value?.username;
}

function parseBoolean(value) {
  if (value === undefined || value === '') return null;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  const error = new Error('筛选条件必须为 true 或 false');
  error.code = 'INVALID';
  throw error;
}

function createAccountAdminRouter({ memberStore, usageStore, accountStore, authRuntime } = {}) {
  if (!memberStore || !usageStore || !accountStore || !authRuntime) throw new Error('account admin dependencies are required');
  const router = express.Router();
  router.use(apiAuth);
  const systemDir = path.dirname(accountStore.files.audit);
  const collaborationStore = createTeamCollaborationStore({ systemDir });
  const governanceStore = governanceStoreForMemberStore(memberStore);

  function requireDev(req, res) {
    const self = memberStore.getMember(req.username);
    if (!self || !self.active || self.role !== 'dev') {
      res.status(403).json({ error: '仅 DEV 可以管理全局账号' });
      return null;
    }
    return self;
  }

  function isOnline(username) {
    for (const session of authRuntime.tokenMap.values()) {
      if (runtimeUsername(session) === username) return true;
    }
    return false;
  }

  function teamForOwner(owner) {
    if (!owner) return null;
    return collaborationStore.getTeamByManager(owner.username)
      || collaborationStore.ensureTeam(owner.username, owner.displayName);
  }

  function ownerSummary(username) {
    const owner = username ? memberStore.getMember(username) : null;
    if (!owner || !['dev', 'manager'].includes(owner.role)) return null;
    const team = teamForOwner(owner);
    const governance = governanceStore.get(owner.username);
    return {
      username: owner.username,
      displayName: owner.displayName,
      role: owner.role,
      team: { id: team.id, name: team.name },
      monthlyTokenLimit: governance.monthlyTokenLimit
    };
  }

  function accountRow(member) {
    return {
      username: member.username,
      displayName: member.displayName,
      role: member.role,
      isOwner: accountStore.getAccount(member.username)?.isOwner === true,
      active: member.active,
      boundTo: member.boundTo,
      teamOwner: ownerSummary(member.role === 'member' ? member.boundTo : member.username),
      apiScopes: [...(member.apiScopes || [])],
      monthlyTokenLimit: member.monthlyTokenLimit,
      presence: { online: isOnline(member.username) },
      usage: { month: usageStore.summaryForUser(member.username, 'month') }
    };
  }

  function transferableMember(username) {
    const member = memberStore.getMember(username);
    if (!member) { const error = new Error('目标账号不存在'); error.code = 'NOT_FOUND'; throw error; }
    if (!member.active) { const error = new Error('停用账号不能转移团队'); error.code = 'CONFLICT'; throw error; }
    if (member.role !== 'member') { const error = new Error('仅 MEMBER 可以转移团队'); error.code = 'INVALID'; throw error; }
    return member;
  }

  function buildTransferPreview(username, boundTo, { resetMonthlyTokenLimit = false } = {}) {
    const member = transferableMember(username);
    const destination = ownerSummary(boundTo);
    if (!destination) { const error = new Error('目标团队负责人不存在或不可用'); error.code = 'NOT_FOUND'; throw error; }
    const destinationAccount = memberStore.getMember(destination.username);
    if (!destinationAccount.active) { const error = new Error('目标团队负责人已停用'); error.code = 'CONFLICT'; throw error; }
    if (member.boundTo === destination.username) { const error = new Error('成员已属于该团队'); error.code = 'CONFLICT'; throw error; }
    const source = ownerSummary(member.boundTo);
    return {
      member: { username: member.username, displayName: member.displayName },
      from: source ? { owner: source, team: source.team, teamMonthlyTokenLimit: source.monthlyTokenLimit } : null,
      to: { owner: destination, team: destination.team, teamMonthlyTokenLimit: destination.monthlyTokenLimit },
      oldScopes: [...(member.apiScopes || [])],
      personalMonthlyTokenLimit: {
        before: member.monthlyTokenLimit,
        after: resetMonthlyTokenLimit ? null : member.monthlyTokenLimit,
        reset: resetMonthlyTokenLimit
      },
      requiresReauthorization: true
    };
  }

  function notifyTransfer(preview, result) {
    const recipients = new Set([result.member.username, preview.from?.owner?.username, preview.to.owner.username].filter(Boolean));
    const sourceName = preview.from?.team?.name || '未归属团队';
    const destinationName = preview.to.team.name;
    for (const username of recipients) {
      const isMember = username === result.member.username;
      collaborationStore.notify(username, {
        type: isMember ? 'team.transferred' : 'team.member_transferred',
        title: isMember ? '所属团队已变更，等待重新授权' : '团队成员归属已变更',
        message: isMember
          ? `你已从「${sourceName}」转入「${destinationName}」，原 API 权限已清除，等待新团队重新授权。`
          : `成员 @${result.member.username} 已从「${sourceName}」转入「${destinationName}」，需要重新授予 API 能力。`,
        metadata: { member: result.member.username, from: preview.from?.owner?.username || null, to: preview.to.owner.username, requiresReauthorization: true }
      });
    }
    return [...recipients];
  }

  router.get('/accounts', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const role = req.query.role ? String(req.query.role).toLowerCase() : null;
      const active = parseBoolean(req.query.active);
      const online = parseBoolean(req.query.online);
      const owner = req.query.owner ? String(req.query.owner) : null;
      const query = String(req.query.query || '').trim().toLowerCase();
      const accounts = memberStore.listMembers().map(accountRow).filter(row => (
        (!role || row.role === role)
        && (active === null || row.active === active)
        && (online === null || row.presence.online === online)
        && (!owner || row.teamOwner?.username === owner)
        && (!query || `${row.username} ${row.displayName}`.toLowerCase().includes(query))
      ));
      return res.json({ accounts });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/accounts', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const body = req.body || {};
      let member = memberStore.createManagedMember(req.username, body);
      if (member.role === 'dev') {
        ensureDevBackendPermissions(accountStore, member);
        member = memberStore.getMember(member.username);
      }
      if (['dev', 'manager'].includes(member.role)) teamForOwner(member);
      collaborationStore.notify(member.username, { type: 'account.created', title: '账号已创建', message: `你的 qiantie 账号 @${member.username} 已创建。` });
      return res.status(201).json({ member: accountRow(member) });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/accounts/:username/transfer-preview', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      return res.json({ preview: buildTransferPreview(req.params.username, req.query.boundTo, { resetMonthlyTokenLimit: req.query.resetMonthlyTokenLimit === 'true' }) });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/accounts/:username/transfer', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const preview = buildTransferPreview(req.params.username, req.body?.boundTo, { resetMonthlyTokenLimit: req.body?.resetMonthlyTokenLimit === true });
      const result = memberStore.transferManagedMember(req.username, req.params.username, {
        boundTo: preview.to.owner.username,
        resetMonthlyTokenLimit: req.body?.resetMonthlyTokenLimit === true
      });
      const recipients = notifyTransfer(preview, result);
      return res.json({ preview, ...result, notifications: { recipients } });
    } catch (error) { return sendError(res, error); }
  });

  router.patch('/accounts/:username', (req, res) => {
    try {
      if (!requireDev(req, res)) return;
      const body = req.body || {};
      if (Object.prototype.hasOwnProperty.call(body, 'boundTo')) {
        const error = new Error('成员转移必须使用专用转移接口，以便清除旧团队 API 授权');
        error.code = 'INVALID';
        throw error;
      }
      const before = memberStore.getMember(req.params.username);
      if (!before) { const error = new Error('目标账号不存在'); error.code = 'NOT_FOUND'; throw error; }
      let member = memberStore.updateManagedMember(req.username, req.params.username, {
        displayName: body.displayName,
        role: body.role,
        monthlyTokenLimit: body.monthlyTokenLimit
      });
      let revoked = null;
      if (member.role === 'dev') {
        ensureDevBackendPermissions(accountStore, member);
      } else if (member.role === 'member' || (before.role !== member.role && member.role !== 'dev')) {
        revoked = revokeBackendPermissions(accountStore, member.username);
      }
      if (['dev', 'manager'].includes(member.role)) teamForOwner(member);
      if (typeof body.active === 'boolean' && body.active !== before.active) {
        accountStore.setActive(devGrantActor(accountStore, req.username), member.username, body.active);
        member = memberStore.getMember(member.username);
      }
      if (body.password !== undefined) {
        accountStore.resetPassword(devGrantActor(accountStore, req.username), member.username, body.password);
      }
      collaborationStore.notify(member.username, { type: 'account.updated', title: '账号设置已更新', message: '开发者更新了你的账号、角色或额度设置。' });
      return res.json({ member: accountRow(member), revoked });
    } catch (error) { return sendError(res, error); }
  });

  return router;
}

module.exports = { createAccountAdminRouter };
