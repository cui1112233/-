const express = require('express');
const { apiAuth, requireCapability, requireOwner } = require('../middleware/auth');
const { slotsForModule } = require('../lib/system-preset-catalog');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');

function sendStoreError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: error.message || 'Not found' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: error.message || 'Forbidden' });
  if (error?.code === 'CONFLICT') return res.status(409).json({ error: error.message });
  return res.status(400).json({ error: error?.message || 'Invalid request' });
}

function createAdminRouter(accountStore, presetStore, agentSkillStore, errorLogStore, { memberStore } = {}) {
  if (!accountStore) throw new Error('accountStore is required');
  if (!presetStore) throw new Error('presetStore is required');
  const router = express.Router();
  router.use(apiAuth);
  const collaborationStore = createTeamCollaborationStore({ systemDir: require('node:path').dirname(accountStore.files.audit) });
  function notifyDevelopers(req, title, message, metadata = null) {
    if (!memberStore) return;
    for (const member of memberStore.listMembers().filter(item => item.role === 'dev' && item.username !== req.username)) {
      collaborationStore.notify(member.username, { type: 'admin.changed', title, message, metadata });
    }
  }

  function requirePresetVersionCapability(capability) {
    return (req, res, next) => {
      try {
        const preset = presetStore.getVersion(req.params.id, req.body?.version);
        if (!preset) return res.status(404).json({ error: 'Not found' });
        if (!accountStore.can(req.username, capability, preset.module)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        req.presetVersion = preset;
        next();
      } catch (error) {
        sendStoreError(res, error);
      }
    };
  }

  router.get('/accounts', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ accounts: accountStore.listAccounts() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/accounts', requireOwner, (req, res) => {
    try {
      res.status(201).json({ account: accountStore.createAccount(req.body) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/applications', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ applications: accountStore.listApplications() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/applications/:id/approve', requireCapability('account:review'), (req, res) => {
    try {
      res.json(accountStore.approveApplication(req.username, req.params.id));
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/applications/:id/reject', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ application: accountStore.rejectApplication(req.username, req.params.id) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/accounts/:username/status', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ account: accountStore.setActive(req.username, req.params.username, req.body?.active) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/accounts/:username/reset-password', requireCapability('account:review'), (req, res) => {
    try {
      res.json({ account: accountStore.resetPassword(req.username, req.params.username, req.body?.password) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/grants', requireOwner, (req, res) => {
    try {
      if (!memberStore) {
        const error = new Error('后台权限授权服务不可用');
        error.code = 'FORBIDDEN';
        throw error;
      }
      const member = memberStore.getMember(req.body?.subject);
      if (!member || !member.active || member.role !== 'manager') {
        const error = new Error('仅 MANAGER 可以接收后台权限');
        error.code = member ? 'FORBIDDEN' : 'NOT_FOUND';
        throw error;
      }
      if (['admin:access', 'account:review'].includes(req.body?.capability) && req.body?.scope !== '*') {
        const error = new Error('该后台权限必须作用于全部模块');
        error.code = 'INVALID';
        throw error;
      }
      res.status(201).json({ grant: accountStore.grant(req.username, req.body?.subject, req.body) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/grants', requireOwner, (req, res) => {
    try {
      res.json({ grants: accountStore.listGrants() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.delete('/grants/:id', requireOwner, (req, res) => {
    try {
      res.json({ grant: accountStore.revokeGrant(req.username, req.params.id) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/audit', requireOwner, (req, res) => {
    try {
      res.json({ audit: accountStore.listAudit() });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/error-logs', requireOwner, (req, res) => {
    if (!errorLogStore) return res.json({ entries: [] });
    return res.json({ entries: errorLogStore.list(req.query.limit) });
  });

  function canManagePreset(req, module) {
    return accountStore.can(req.username, 'admin:access', '*')
      || accountStore.can(req.username, 'preset:draft', module)
      || accountStore.can(req.username, 'preset:publish', module);
  }

  router.get('/presets', (req, res) => {
    const module = req.query.module;
    if (!canManagePreset(req, module)) return res.status(403).json({ error: 'Forbidden' });
    try {
      res.json({ presets: presetStore.listAll(module) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/preset-slots', (req, res) => {
    const module = req.query.module;
    if (!canManagePreset(req, module)) return res.status(403).json({ error: 'Forbidden' });
    return res.json({ slots: slotsForModule(module) });
  });

  router.get('/presets/:id/:version', (req, res) => {
    try {
      const preset = presetStore.getVersion(req.params.id, Number(req.params.version));
      if (!preset) return res.status(404).json({ error: 'Not found' });
      if (!canManagePreset(req, preset.module)) return res.status(403).json({ error: 'Forbidden' });
      res.json({ preset });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/presets/draft', requireCapability('preset:draft', req => req.body?.module), (req, res) => {
    try {
      const preset = presetStore.createDraft(req.username, req.body);
      notifyDevelopers(req, '管理后台发生变更', `@${req.username} 创建了「${preset.name || preset.id}」预设词草稿。`, { action: 'preset.draft', presetId: preset.id });
      res.status(201).json({ preset });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/presets/:id/publish', requirePresetVersionCapability('preset:publish'), (req, res) => {
    try {
      const preset = presetStore.publish(req.username, req.params.id, req.body?.version);
      notifyDevelopers(req, '管理后台发生变更', `@${req.username} 发布了预设词「${preset.name || req.params.id}」。`, { action: 'preset.publish', presetId: req.params.id, version: req.body?.version });
      res.json({ preset });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/presets/:id/rollback', requirePresetVersionCapability('preset:publish'), (req, res) => {
    try {
      const preset = presetStore.rollback(req.username, req.params.id, req.body?.version);
      notifyDevelopers(req, '管理后台发生变更', `@${req.username} 回滚了预设词「${preset.name || req.params.id}」。`, { action: 'preset.rollback', presetId: req.params.id, version: req.body?.version });
      res.json({ preset });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.get('/agent-skills', requireOwner, (req, res) => {
    if (!agentSkillStore) return res.status(404).json({ error: 'Not found' });
    return res.json({ skills: agentSkillStore.listSystem() });
  });

  router.get('/agent-skills/:id/:version', requireOwner, (req, res) => {
    if (!agentSkillStore) return res.status(404).json({ error: 'Not found' });
    const skill = agentSkillStore.getSystem(req.params.id, req.params.version);
    if (!skill) return res.status(404).json({ error: 'Not found' });
    return res.json({ skill });
  });

  router.post('/agent-skills/draft', requireOwner, (req, res) => {
    if (!agentSkillStore) return res.status(404).json({ error: 'Not found' });
    try {
      return res.status(201).json({ skill: agentSkillStore.createSystemDraft(req.username, req.body) });
    } catch (error) {
      return sendStoreError(res, error);
    }
  });

  router.post('/agent-skills/:id/publish', requireOwner, (req, res) => {
    if (!agentSkillStore) return res.status(404).json({ error: 'Not found' });
    try {
      return res.json({ skill: agentSkillStore.setSystemStatus(req.username, req.params.id, req.body?.version, 'published') });
    } catch (error) {
      return sendStoreError(res, error);
    }
  });

  router.post('/agent-skills/:id/archive', requireOwner, (req, res) => {
    if (!agentSkillStore) return res.status(404).json({ error: 'Not found' });
    try {
      return res.json({ skill: agentSkillStore.setSystemStatus(req.username, req.params.id, req.body?.version, 'archived') });
    } catch (error) {
      return sendStoreError(res, error);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
