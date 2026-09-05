const {
  PRIMARY_USER,
  rateLimitMap,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  createAuthRuntime
} = require('../lib/shared');
const { getPersistentSession, revokePersistentSession } = require('../lib/session-store');

function getRuntime(req) {
  // Mounted sub-applications inherit their runtime from the parent app.
  for (let app = req.app; app; app = app.parent) {
    if (app.locals?.authRuntime) return app.locals.authRuntime;
  }
  return createAuthRuntime();
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

function authenticateRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\\s+(.+)$/i);
  if (!match) return null;
  const runtime = getRuntime(req);
  const token = match[1];
  const storedSession = runtime.tokenMap.get(token);
  const persistentSession = !storedSession ? getPersistentSession(runtime.sessionsPath, token) : null;
  const username = storedSession?.username || persistentSession?.username;
  if (typeof username !== 'string') return null;

  try {
    const account = runtime.accountStore.getAccount(username);
    if (!account || !account.active || account.pending === true) {
      runtime.tokenMap.delete(token);
      revokePersistentSession(runtime.sessionsPath, token);
      return null;
    }
    return { username: account.username, account, effectivePermissions: runtime.accountStore.effectivePermissions(account) };
  } catch (error) {
    return null;
  }
}

function applyAuthentication(req, auth) {
  req.username = auth.username;
  req.auth = auth;
}

function apiAuth(req, res, next) {
  const auth = authenticateRequest(req);
  if (!auth) {
    res.set('X-Qiantie-Auth-Failure', 'session');
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
  applyAuthentication(req, auth);
  next();
}

function optionalApiAuth(req, res, next) {
  const auth = authenticateRequest(req);
  if (auth) applyAuthentication(req, auth);
  next();
}

function requireCapability(capability, getScope = () => '*') {
  return (req, res, next) => {
    const runtime = getRuntime(req);
    try {
      if (req.auth && req.app?.locals?.memberStore?.effectiveRole(req.auth.username) === 'dev') return next();
    } catch {
      // Keep legacy account capability checks as the safe fallback.
    }
    const adminAccess = capability !== 'account:review' && capability !== 'admin:access'
      && runtime.accountStore.can(req.auth?.username, 'admin:access', '*');
    if (!req.auth || (!runtime.accountStore.can(req.auth.username, capability, getScope(req)) && !adminAccess)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function requireOwner(req, res, next) {
  const runtime = getRuntime(req);
  const account = req.auth && runtime.accountStore.getAccount(req.auth.username);
  try {
    if (account?.active && req.app?.locals?.memberStore?.effectiveRole(account.username) === 'dev') return next();
  } catch {
    // Keep the existing Owner-only behaviour if membership data cannot be read.
  }
  if (!account || !account.active || account.username !== PRIMARY_USER || !account.isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { checkRateLimit, apiAuth, optionalApiAuth, requireCapability, requireOwner };
