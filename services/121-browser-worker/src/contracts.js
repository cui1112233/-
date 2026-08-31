const SESSION_ROUTES = Object.freeze({
  login: '/session/login',
  test: '/session/test',
  refresh: '/session/refresh',
  remove: '/session'
});

const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('baseUrl must use http or https');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function normalizeSessionRequest(body = {}, { requireCredentials = false } = {}) {
  const owner = String(body.owner || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!OWNER_PATTERN.test(owner)) throw new Error('invalid owner');
  if (!username) throw new Error('username is required');
  if (requireCredentials && !password) throw new Error('password is required');
  return {
    owner,
    baseUrl: normalizeBaseUrl(body.baseUrl),
    username,
    ...(requireCredentials ? { password } : {}),
    headed: body.headed === true,
    landingPath: String(body.landingPath || 'booklist.php').trim() || 'booklist.php'
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

module.exports = { SESSION_ROUTES, normalizeBaseUrl, normalizeSessionRequest, sanitizeSessionResponse };
