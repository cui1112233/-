const SESSION_ROUTES = Object.freeze({
  login: '/session/login',
  test: '/session/test',
  refresh: '/session/refresh',
  remove: '/session'
});

const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET_HOST = 'two.121w.com';
const TARGET_PATH = '/tttadmin';

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('baseUrl must use http or https');
  if (url.username || url.password || url.port) throw new Error('invalid 121 target');
  if (url.hostname.toLowerCase() !== TARGET_HOST) throw new Error('invalid 121 target');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== TARGET_PATH || url.search || url.hash) throw new Error('invalid 121 target');
  return `${url.protocol}//${TARGET_HOST}${TARGET_PATH}`;
}

function normalizeSessionRequest(body = {}, { requireCredentials = false } = {}) {
  const owner = String(body.owner || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!OWNER_PATTERN.test(owner)) throw new Error('invalid owner');
  if (!username) throw new Error('username is required');
  if (requireCredentials && !password) throw new Error('password is required');
  const landingPath = String(body.landingPath || 'booklist.php').trim() || 'booklist.php';
  if (landingPath !== 'booklist.php') throw new Error('invalid 121 landing path');
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

module.exports = { SESSION_ROUTES, TARGET_HOST, TARGET_PATH, normalizeBaseUrl, normalizeSessionRequest, sanitizeSessionResponse };
