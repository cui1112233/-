const SESSION_ROUTES = Object.freeze({
  login: '/session/login',
  test: '/session/test',
  refresh: '/session/refresh',
  remove: '/session'
});

const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET_HOST = 'two.121w.com';
const TARGET_ADMIN_PATH = '/tttadmin';
const FORBIDDEN_DEV_SECRET = 'dev-bridge-secret-change-me';

function requireStrongSecret(value, label = 'secret') {
  const secret = String(value || '').trim();
  if (!secret) throw new Error(`${label} is required`);
  if (secret === FORBIDDEN_DEV_SECRET) throw new Error(`${label} must not use the development default`);
  return secret;
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('baseUrl must use http or https');
  if (url.hostname.toLowerCase() !== TARGET_HOST) throw new Error(`baseUrl host must be exactly ${TARGET_HOST}`);
  if (url.username || url.password) throw new Error('baseUrl credentials/userinfo are not allowed');
  if (url.port) throw new Error('baseUrl custom port is not allowed');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== TARGET_ADMIN_PATH) throw new Error(`baseUrl path must be ${TARGET_ADMIN_PATH}`);
  return `${url.protocol}//${TARGET_HOST}${TARGET_ADMIN_PATH}`;
}

function normalizeSessionRequest(body = {}, { requireCredentials = false } = {}) {
  const owner = String(body.owner || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!OWNER_PATTERN.test(owner)) throw new Error('invalid owner');
  if (!username) throw new Error('username is required');
  if (requireCredentials && !password) throw new Error('password is required');
  const landingPath = String(body.landingPath || 'booklist.php').trim() || 'booklist.php';
  if (landingPath.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(landingPath)) throw new Error('invalid landingPath');
  return {
    owner,
    baseUrl: normalizeBaseUrl(body.baseUrl),
    username,
    ...(requireCredentials ? { password } : {}),
    headed: body.headed === true,
    landingPath
  };
}

function sanitizeSessionResponse(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const safe = {};
  for (const key of ['ok', 'owner', 'sessionKey', 'status', 'detail', 'expiresAt', 'refreshedAt', 'capability']) {
    if (source[key] !== undefined) safe[key] = source[key];
  }
  return safe;
}

module.exports = {
  SESSION_ROUTES,
  TARGET_HOST,
  TARGET_ADMIN_PATH,
  FORBIDDEN_DEV_SECRET,
  requireStrongSecret,
  normalizeBaseUrl,
  normalizeSessionRequest,
  sanitizeSessionResponse
};
