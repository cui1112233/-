const target = require('../target-upload');

function text(value) { return String(value || '').trim(); }

function parseJSON(value, label) {
  try { return JSON.parse(String(value || '{}')); }
  catch (_) { throw new Error(`${label}返回了非 JSON 数据`); }
}

function sessionExpiredError() {
  const error = new Error('121 登录会话已失效，请重新验证登录');
  error.code = 'SESSION_EXPIRED';
  error.status = 401;
  return error;
}

function remoteError(response, fallback = '121 接口请求失败') {
  const error = new Error(`${fallback}（HTTP ${Number(response?.status) || 0}）`);
  error.code = 'TARGET_HTTP_ERROR';
  error.status = Number(response?.status) || 502;
  return error;
}

function safeTargetPath(value) {
  const path = String(value || '').trim();
  if (!path.startsWith('/tttadmin/') || path.includes('://') || path.includes('..')) {
    throw new Error('invalid 121 target path');
  }
  return path;
}

function targetURL(path) {
  return `http://${target.TARGET_HOST}${safeTargetPath(path)}`;
}

function create121DirectClient({ requestHttp = target.requestHttp } = {}) {
  if (typeof requestHttp !== 'function') throw new Error('requestHttp is required');

  async function verify({ cookie } = {}) {
    const sessionCookie = text(cookie);
    if (!sessionCookie) throw sessionExpiredError();
    const response = await requestHttp({
      method: 'GET',
      url: targetURL(target.TARGET_CHECK_PATH),
      headers: { Cookie: sessionCookie },
      timeoutMs: target.TARGET_CHECK_TIMEOUT_MS
    });
    if (Number(response?.status) >= 400) throw remoteError(response, '121 后台页面验证失败');
    if (target.isLoginPage(response?.body) || !target.isDashboard(response?.body)) throw sessionExpiredError();
    return { ok: true, cookie: sessionCookie, response };
  }

  async function login({ username, password } = {}) {
    const user = text(username);
    const secret = String(password || '');
    if (!user || !secret) throw new Error('121 登录需要账号和密码');
    const landing = await requestHttp({ method: 'GET', url: target.buildLoginPageUrl() });
    if (Number(landing?.status) >= 400) throw remoteError(landing, '121 登录页请求失败');
    const initialCookie = target.cookieHeaderFromSetCookie(landing?.headers);
    const loginResponse = await requestHttp(target.buildLoginRequest(user, secret, initialCookie));
    if (Number(loginResponse?.status) >= 400) throw remoteError(loginResponse, '121 登录请求失败');
    const payload = parseJSON(loginResponse?.body, '121 登录接口');
    if (payload?.success !== true) throw new Error(text(payload?.message || payload?.msg) || '121 登录失败');
    const cookie = target.mergeCookieHeaders(initialCookie, target.cookieHeaderFromSetCookie(loginResponse?.headers));
    if (!cookie) throw new Error('121 登录未返回会话');
    await verify({ cookie });
    return { ok: true, cookie };
  }

  async function action({ cookie, method = 'GET', path, headers = {}, body, timeoutMs } = {}) {
    const sessionCookie = text(cookie);
    if (!sessionCookie) throw sessionExpiredError();
    const response = await requestHttp({
      method: String(method || 'GET').toUpperCase(),
      url: targetURL(path),
      headers: { ...headers, Cookie: sessionCookie },
      body,
      timeoutMs
    });
    if (Number(response?.status) >= 400) throw remoteError(response);
    if (target.isLoginPage(response?.body)) throw sessionExpiredError();
    return response;
  }

  // Only consume a pre-signed URL returned by the authenticated 121 API for
  // a requested asset. Browser input never supplies this destination.
  async function uploadPresigned({ url, headers = {}, body, timeoutMs = 120000 } = {}) {
    const targetURL = String(url || '').trim();
    let parsed;
    try { parsed = new URL(targetURL); } catch (_) { throw new Error('121 素材上传地址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('121 素材上传地址协议无效');
    const response = await requestHttp({ method: 'PUT', url: targetURL, headers, body, timeoutMs });
    if (Number(response?.status) < 200 || Number(response?.status) >= 300) throw remoteError(response, '121 自定义 AI 头部视频上传失败');
    return response;
  }

  return { login, verify, action, uploadPresigned };
}

module.exports = { create121DirectClient, sessionExpiredError, remoteError, safeTargetPath };
