const {
  PRIMARY_USER,
  rateLimitMap,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  createAuthRuntime
} = require('../lib/shared');

function getRuntime(req) {
  return req.app?.locals?.authRuntime || createAuthRuntime();
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function apiAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
  }
  const runtime = getRuntime(req);
  const session = runtime.tokenMap.get(match[1]);
  if (!session || typeof session.username !== 'string' || typeof session.issuedAt !== 'number') {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }

  try {
    const account = runtime.accountStore.getAccount(session.username);
    if (!account || !account.active || account.pending === true) {
      return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
    }
    const effectivePermissions = runtime.accountStore.effectivePermissions(account);
    req.username = account.username;
    req.auth = { username: account.username, account, effectivePermissions };
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
  next();
}

function requireCapability(capability, getScope = () => '*') {
  return (req, res, next) => {
    const runtime = getRuntime(req);
    if (!req.auth || !runtime.accountStore.can(req.auth.username, capability, getScope(req))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function requireOwner(req, res, next) {
  const runtime = getRuntime(req);
  const account = req.auth && runtime.accountStore.getAccount(req.auth.username);
  if (!account || !account.active || account.username !== PRIMARY_USER || !account.isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { checkRateLimit, apiAuth, requireCapability, requireOwner };
