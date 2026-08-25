const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { ensureDevBackendPermissions, devGrantActor } = require('../lib/dev-permissions');

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

function createMemberCenterRouter({ memberStore, usageStore, avatarsDir, accountStore } = {}) {
  if (!memberStore) throw new Error('memberStore is required');
  if (!usageStore) throw new Error('usageStore is required');
  if (!avatarsDir) throw new Error('avatarsDir is required');

  const router = express.Router();
  router.use(apiAuth);

  function getAccountStore(req) {
    const resolved = accountStore || req.app?.locals?.authRuntime?.accountStore;
    if (!resolved) throw new Error('accountStore is required');
    return resolved;
  }

  function requireDev(req, res) {
    const self = memberStore.getMember(req.username);
    if (!self || self.role !== 'dev') {
      res.status(403).json({ error: '仅 DEV 可以执行此操作' });
      return null;
    }
    return self;
  }

  router.get('/me', (req, res) => {
    try {
      const member = memberStore.getMember(req.username);
      if (!member) return res.status(404).json({ error: '账号不存在' });
      const manager = member.boundTo ? memberStore.getMember(member.boundTo) : null;
      return res.json({
        member,
        manager,
        usage: {
          day: usageStore.summaryForUser(req.username, 'day'),
          month: usageStore.summaryForUser(req.username, 'month'),
          recent: usageStore.recentForUser(req.username, 12)
        }
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/profile', (req, res) => {
    try {
      const member = memberStore.updateOwnProfile(req.username, {
        displayName: req.body?.displayName
      });
      return res.json({ member });
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
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) {
        return res.status(403).json({ error: '当前身份没有团队管理权限' });
      }
      const members = memberStore.visibleTeam(req.username);
      const usernames = members.map(item => item.username);
      const month = usageStore.summariesForUsers(usernames, 'month');
      const day = usageStore.summariesForUsers(usernames, 'day');
      return res.json({
        members: members.map(member => ({
          ...member,
          usage: { day: day[member.username], month: month[member.username] }
        }))
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members', (req, res) => {
    try {
      const self = memberStore.getMember(req.username);
      if (!self || !['dev', 'manager'].includes(self.role)) {
        return res.status(403).json({ error: '当前身份没有成员创建权限' });
      }
      const body = req.body || {};
      const requestedRole = self.role === 'manager' ? 'member' : (body.role || 'member');
      const resolvedBoundTo = self.role === 'manager' ? self.username : (body.boundTo || null);
      if (requestedRole === 'member' && body.apiEnabled === true && !resolvedBoundTo) {
        return res.status(400).json({ error: '请先绑定 MANAGER，再开启团队 API。' });
      }
      let member = memberStore.createManagedMember(req.username, {
        ...body,
        role: requestedRole,
        boundTo: resolvedBoundTo
      });
      if (member.role === 'dev') {
        ensureDevBackendPermissions(getAccountStore(req), member);
        member = memberStore.getMember(member.username);
      }
      return res.status(201).json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.patch('/team/members/:username', (req, res) => {
    try {
      let member = memberStore.updateManagedMember(req.username, req.params.username, req.body || {});
      if (member.role === 'dev') {
        ensureDevBackendPermissions(getAccountStore(req), member);
        member = memberStore.getMember(member.username);
      }
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.post('/team/members/:username/api', (req, res) => {
    try {
      const member = memberStore.setApiAccess(
        req.username,
        req.params.username,
        req.body?.enabled,
        req.body?.scope || '*'
      );
      return res.json({ member });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  router.get('/team/members/:username/usage', (req, res) => {
    try {
      const visible = new Set(memberStore.visibleTeam(req.username).map(item => item.username));
      if (!visible.has(req.params.username)) return res.status(403).json({ error: '无权查看该成员用量' });
      return res.json({
        day: usageStore.summaryForUser(req.params.username, 'day'),
        month: usageStore.summaryForUser(req.params.username, 'month'),
        recent: usageStore.recentForUser(req.params.username, 50)
      });
    } catch (error) {
      return sendMemberError(res, error);
    }
  });

  // 继续复用原有 grants.json 作为后台模块权限来源；DEV 通过这里分配，
  // account-store 仍由真实 Owner 作为写入 actor 保持旧数据约束。
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
      const grant = store.grant(actor, subject, {
        capability: req.body?.capability,
        scope: req.body?.scope || '*'
      });
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

module.exports = { createMemberCenterRouter, parseAvatarDataUrl };
