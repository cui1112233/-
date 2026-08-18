const {
  PRIMARY_USER,
  rateLimitMap,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  createAuthRuntime
} = require('../lib/shared');
const { getPersistentSession, revokePersistentSession } = require('../lib/session-store');

function getRuntime(req) {
  // 挂载的子应用（如 routes/storage.js 返回的 express() 子应用）内部 req.app 指向子应用自身，
  // 其 locals 不含 authRuntime；沿 parent 链向上找到宿主 app 的运行时。
  for (let app = req.app; app; app = app.parent) {
    if (app.locals && app.locals.authRuntime) return app.locals.authRuntime;
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

module.exports = { checkRateLimit, apiAuth, optionalApiAuth, requireCapability, requireOwner };
