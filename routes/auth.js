const express = require('express');
const crypto = require('crypto');
const { createAuthRuntime, userSessions } = require('../lib/shared');
const { createPersistentSession, revokePersistentSession } = require('../lib/session-store');
const { apiAuth } = require('../middleware/auth');

const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function createAuthRouter(runtime = createAuthRuntime(), memberStore) {
  const router = express.Router();

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
      active: account.active,
      isOwner: account.isOwner,
      effectivePermissions
    };
  }

  // POST /api/login — 登录（无需鉴权）
  router.post('/', (req, res) => {
    const { username, password, remember } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (!runtime.accountStore.verifyPassword(username, password)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const account = runtime.accountStore.getAccount(username);
    if (!account || !account.active || account.pending === true) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    runtime.tokenMap.set(token, { username: account.username, issuedAt: Date.now() });
    if (remember === true) {
      try {
        createPersistentSession(runtime.sessionsPath, token, account.username, REMEMBER_DURATION_MS);
      } catch {
        runtime.tokenMap.delete(token);
        return res.status(503).json({ error: '登录服务暂不可用，请稍后重试' });
      }
    }
    if (!userSessions.has(account.username)) {
      userSessions.set(account.username, {});
    }
    res.json({ token, ...sessionShape(account, runtime.accountStore.effectivePermissions(account)) });
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

module.exports = { createAuthRouter, REMEMBER_DURATION_MS };
