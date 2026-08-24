const {
  PRIMARY_USER,
  rateLimitMap,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  createAuthRuntime
} = require('../lib/shared');
const { getPersistentSession, revokePersistentSession } = require('../lib/session-store');

function getRuntime(req) {
  return req.app?.locals?.authRuntime || createAuthRuntime();
}

function memberRole(req, username) {
  try {
    return req.app?.locals?.memberStore?.effectiveRole(username) || null;
  } catch {
    return null;
  }
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
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
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
  if (!auth) return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
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
    if (req.auth && memberRole(req, req.auth.username) === 'dev') return next();
    if (!req.auth || !runtime.accountStore.can(req.auth.username, capability, getScope(req))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Legacy name kept for route compatibility. Owner is always DEV, and promoted
// DEV accounts may enter the same operational backend routes. Owner-only data
// invariants remain enforced by the underlying account store where applicable.
function requireOwner(req, res, next) {
  const runtime = getRuntime(req);
  const account = req.auth && runtime.accountStore.getAccount(req.auth.username);
  if (!account || !account.active) return res.status(403).json({ error: 'Forbidden' });
  if (memberRole(req, account.username) === 'dev') return next();
  if (account.username === PRIMARY_USER && account.isOwner) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

module.exports = { checkRateLimit, apiAuth, optionalApiAuth, requireCapability, requireOwner };
