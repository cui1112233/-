const express = require('express');
const crypto = require('crypto');
const { createAuthRuntime, userSessions } = require('../lib/shared');

function createAuthRouter(runtime = createAuthRuntime()) {
  const router = express.Router();

  // POST /api/login — 登录（无需鉴权）
  router.post('/', (req, res) => {
    const { username, password } = req.body || {};
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
    if (!userSessions.has(account.username)) {
      userSessions.set(account.username, {});
    }
    res.json({
      token,
      username: account.username,
      active: account.active,
      isOwner: account.isOwner,
      effectivePermissions: runtime.accountStore.effectivePermissions(account)
    });
  });

  return router;
}

module.exports = { createAuthRouter };
