const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { createProfileDetailsStore } = require('../lib/profile-details-store');
const { createAccountRecoveryStore } = require('../lib/account-recovery-store');
const { createPasskeyStore } = require('../lib/passkey-store');
const { createMfaStore } = require('../lib/mfa-store');
const { createTeamCollaborationStore } = require('../lib/team-collaboration-store');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../lib/system-store');
const { revokePersistentSessionsForUser } = require('../lib/session-store');
const { requestOrigin, requestRpId } = require('./auth');

function routeError(res, error) {
  const status = error?.code === 'NOT_FOUND' ? 404
    : error?.code === 'FORBIDDEN' ? 403
      : error?.code === 'CONFLICT' ? 409
        : error?.code === 'MAIL_UNAVAILABLE' ? 503
          : error?.code === 'MAIL_DELIVERY_FAILED' ? 502
            : 400;
  return res.status(status).json({ error: error?.message || '请求失败', ...(error?.code ? { code: error.code } : {}) });
}

function absoluteUrl(req, pathname) {
  return new URL(pathname, requestOrigin(req)).toString();
}

function createAccountRecoveryRouter({ accountStore, memberStore, authRuntime, mailer, recoveryStore: injectedRecoveryStore, passkeyStore: injectedPasskeyStore, avatarsDir } = {}) {
  if (!accountStore || !memberStore || !authRuntime) throw new Error('account recovery dependencies are required');
  const router = express.Router();
  const systemDir = path.dirname(accountStore.files.audit);
  const profileStore = createProfileDetailsStore({ systemDir });
  const recoveryStore = injectedRecoveryStore || createAccountRecoveryStore({ systemDir });
  const passkeyStore = injectedPasskeyStore || createPasskeyStore({ systemDir });
  const mfaStore = createMfaStore({ systemDir });
  const collaborationStore = createTeamCollaborationStore({ systemDir });
  const resolvedMailer = mailer || { isConfigured: false, async send() { const error = new Error('邮件发送通道尚未配置'); error.code = 'MAIL_UNAVAILABLE'; throw error; } };

  function ownerUsername() {
    const owner = accountStore.listAccounts().find(item => item.isOwner);
    if (!owner) throw new Error('Owner account is missing');
    return owner.username;
  }

  function revokeAllSessions(username) {
    let runtime = 0;
    for (const [token, value] of authRuntime.tokenMap.entries()) {
      const candidate = typeof value === 'string' ? value : value?.username;
      if (candidate !== username) continue;
      authRuntime.tokenMap.delete(token);
      runtime += 1;
    }
    const persistent = revokePersistentSessionsForUser(authRuntime.sessionsPath, username);
    return { runtime, persistent };
  }

  function redactMemberFiles(username) {
    return withJsonLock(memberStore.files.lock, () => {
      const profilesResult = readJsonOrMissing(memberStore.files.profiles);
      const grantsResult = readJsonOrMissing(memberStore.files.grants);
      const profiles = profilesResult.found && Array.isArray(profilesResult.value) ? profilesResult.value : [];
      const grants = grantsResult.found && Array.isArray(grantsResult.value) ? grantsResult.value : [];
      const profile = profiles.find(item => item.username === username);
      if (profile) {
        profile.displayName = '已删除用户';
        profile.avatarUrl = null;
        profile.boundTo = null;
        profile.monthlyTokenLimit = null;
        profile.updatedAt = new Date().toISOString();
      }
      writeJsonAtomic(memberStore.files.profiles, profiles);
      writeJsonAtomic(memberStore.files.grants, grants.filter(item => item.subject !== username));
    });
  }

  function purgeMfa(username) {
    const filePath = path.join(systemDir, 'mfa.json');
    const lockPath = path.join(systemDir, 'mfa.lock');
    return withJsonLock(lockPath, () => {
      const result = readJsonOrMissing(filePath);
      if (!result.found) return 0;
      if (!Array.isArray(result.value)) throw new Error('Invalid MFA store');
      const next = result.value.filter(item => item.username !== username);
      const removed = result.value.length - next.length;
      if (removed) writeJsonAtomic(filePath, next);
      return removed;
    });
  }

  router.get('/email/status', apiAuth, (req, res) => {
    try {
      const profile = profileStore.get(req.username);
      return res.json({ ...recoveryStore.emailStatus(req.username, profile?.email), deliveryConfigured: Boolean(resolvedMailer.isConfigured) });
    } catch (error) { return routeError(res, error); }
  });

  router.post('/email/request', apiAuth, async (req, res) => {
    let issued = null;
    try {
      if (!resolvedMailer.isConfigured) { const error = new Error('邮件发送通道尚未配置'); error.code = 'MAIL_UNAVAILABLE'; throw error; }
      const profile = profileStore.get(req.username);
      if (!profile?.email) return res.status(400).json({ error: '请先在个人资料中填写邮箱' });
      issued = recoveryStore.issueEmailVerification(req.username, profile.email);
      const url = absoluteUrl(req, `/recover?verify=${encodeURIComponent(issued.token)}`);
      await resolvedMailer.send({
        to: profile.email,
        subject: '验证你的一战晟铭邮箱',
        text: `请在 30 分钟内打开以下链接完成邮箱验证：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`
      });
      return res.json({ sent: true, email: profile.email, expiresAt: issued.record.expiresAt });
    } catch (error) {
      if (issued) recoveryStore.revokeEmailVerification(req.username);
      return routeError(res, error);
    }
  });

  router.post('/email/verify', (req, res) => {
    try {
      const verified = recoveryStore.verifyEmailToken(req.body?.token);
      const current = profileStore.get(verified.username);
      if (!current?.email || current.email !== verified.email) return res.status(409).json({ error: '邮箱已经发生变化，请重新发送验证邮件' });
      collaborationStore.notify(verified.username, { type: 'security.email_verified', title: '邮箱验证完成', message: `${verified.email} 已完成验证，可用于找回密码。` });
      return res.json({ verified: true, email: verified.email, verifiedAt: verified.verifiedAt });
    } catch (error) { return routeError(res, error); }
  });

  router.post('/password/request', async (req, res) => {
    try {
      if (!resolvedMailer.isConfigured) { const error = new Error('邮件发送通道尚未配置'); error.code = 'MAIL_UNAVAILABLE'; throw error; }
      const email = String(req.body?.email || '').trim().toLowerCase();
      const username = recoveryStore.verifiedUsernameForEmail(email);
      const account = username ? accountStore.getAccount(username) : null;
      const profile = username ? profileStore.get(username) : null;
      if (account?.active && profile?.email === email) {
        const issued = recoveryStore.issuePasswordReset(username, email);
        const url = absoluteUrl(req, `/recover?reset=${encodeURIComponent(issued.token)}`);
        try {
          await resolvedMailer.send({
            to: email,
            subject: '重置你的一战晟铭密码',
            text: `请在 30 分钟内打开以下链接设置新密码：\n${url}\n\n该链接只能使用一次。如果不是你本人申请，请忽略此邮件。`
          });
        } catch (error) {
          recoveryStore.revokePasswordReset(username);
          throw error;
        }
      }
      return res.status(202).json({ accepted: true, message: '如果该邮箱已验证并绑定账号，重置邮件将会发送。' });
    } catch (error) { return routeError(res, error); }
  });

  router.post('/password/reset', (req, res) => {
    try {
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' });
      const record = recoveryStore.consumePasswordReset(req.body?.token);
      const account = accountStore.getAccount(record.username);
      if (!account || !account.active) return res.status(409).json({ error: '账号当前不可用' });
      accountStore.resetPassword(ownerUsername(), record.username, password);
      const revoked = revokeAllSessions(record.username);
      collaborationStore.notify(record.username, { type: 'security.password_recovered', title: '密码已通过邮箱重置', message: '所有旧登录会话已经撤销。' });
      return res.json({ reset: true, revoked });
    } catch (error) { return routeError(res, error); }
  });

  router.get('/passkeys', apiAuth, (req, res) => {
    try { return res.json({ passkeys: passkeyStore.listCredentials(req.username) }); }
    catch (error) { return routeError(res, error); }
  });

  router.post('/passkeys/options', apiAuth, (req, res) => {
    try {
      if (!accountStore.verifyPassword(req.username, req.body?.currentPassword)) {
        return res.status(400).json({ error: '当前密码不正确，无法绑定 Passkey' });
      }
      const member = memberStore.getMember(req.username);
      return res.json(passkeyStore.beginRegistration(req.username, {
        rpId: requestRpId(req), origin: requestOrigin(req), displayName: member?.displayName || req.username
      }));
    } catch (error) { return routeError(res, error); }
  });

  router.post('/passkeys', apiAuth, (req, res) => {
    try {
      const credential = passkeyStore.finishRegistration(req.username, {
        ...(req.body?.credential || {}),
        challenge: req.body?.challenge,
        origin: requestOrigin(req),
        rpId: requestRpId(req),
        name: req.body?.name
      });
      collaborationStore.notify(req.username, { type: 'security.passkey_added', title: 'Passkey 已添加', message: `${credential.name} 已绑定到账号。` });
      return res.status(201).json({ credential });
    } catch (error) { return routeError(res, error); }
  });

  router.delete('/passkeys/:id', apiAuth, (req, res) => {
    try {
      const removed = passkeyStore.removeCredential(req.username, req.params.id);
      collaborationStore.notify(req.username, { type: 'security.passkey_removed', title: 'Passkey 已移除', message: `${removed.name} 已从账号删除。` });
      return res.json({ removed });
    } catch (error) { return routeError(res, error); }
  });

  router.post('/purge/:username', apiAuth, (req, res) => {
    try {
      const actor = memberStore.getMember(req.username);
      const target = memberStore.getMember(req.params.username);
      if (!actor || actor.role !== 'dev') return res.status(403).json({ error: '仅 DEV 可以永久删除账号' });
      if (!accountStore.verifyPassword(actor.username, req.body?.currentPassword)) return res.status(400).json({ error: '当前 DEV 密码不正确' });
      if (!target || target.isOwner) return res.status(400).json({ error: '目标账号不可删除' });
      if (target.role !== 'member') return res.status(409).json({ error: '仅允许永久删除 MEMBER；请先完成团队转移与角色调整' });
      if (target.active) return res.status(409).json({ error: '请先归档并停用成员，再执行永久删除' });
      if (!collaborationStore.getArchive(target.username)) return res.status(409).json({ error: '成员尚未归档' });
      if (String(req.body?.confirmation || '') !== target.username) return res.status(400).json({ error: '请输入完整账号名确认永久删除' });

      const revoked = revokeAllSessions(target.username);
      const removedPasskeys = passkeyStore.purgeUser(target.username);
      const removedMfa = purgeMfa(target.username);
      recoveryStore.revokeEmailVerification(target.username);
      recoveryStore.revokePasswordReset(target.username);
      profileStore.clear(target.username);
      redactMemberFiles(target.username);
      accountStore.resetPassword(ownerUsername(), target.username, crypto.randomBytes(48).toString('base64url'));
      if (avatarsDir) {
        for (const ext of ['png', 'jpg', 'webp']) {
          try { fs.unlinkSync(path.join(avatarsDir, `${target.username}.${ext}`)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        }
      }
      const tombstone = recoveryStore.markDeleted(target.username, actor.username, req.body?.reason);
      return res.json({ deleted: true, tombstone, revoked, removedPasskeys, removedMfa, auditRetained: true });
    } catch (error) { return routeError(res, error); }
  });

  return router;
}

module.exports = { createAccountRecoveryRouter };
