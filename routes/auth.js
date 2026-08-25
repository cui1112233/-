const express = require('express');
const crypto = require('crypto');
const { createAuthRuntime, userSessions } = require('../lib/shared');
const { createPersistentSession, revokePersistentSession } = require('../lib/session-store');
const { apiAuth } = require('../middleware/auth');

const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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
    const issuedAt = Date.now();
    const device = sessionMetadata(req);
    runtime.tokenMap.set(token, { username: account.username, issuedAt, ...device });
    if (remember === true) {
      try {
        createPersistentSession(runtime.sessionsPath, token, account.username, REMEMBER_DURATION_MS, issuedAt, device);
      } catch {
        runtime.tokenMap.delete(token);
        return res.status(503).json({ error: '登录服务暂不可用，请稍后重试' });
      }
    }
    if (!userSessions.has(account.username)) {
      userSessions.set(account.username, {});
    }
    res.json({
      token,
      ...sessionShape(account, runtime.accountStore.effectivePermissions(account))
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
  sessionMetadata
};
