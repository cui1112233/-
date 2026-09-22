'use strict';

// V88 talks to the 121 PHP JSON API directly. The historical module name is
// retained so existing composition and test injection points stay compatible.
const target = require('../target-upload');

function unavailableError(message = '121 接口服务不可用') {
  const error = new Error(message);
  error.code = 'TARGET_API_UNAVAILABLE';
  error.recoverable = false;
  return error;
}

function normalizeTargetBaseUrl(value) {
  const raw = String(value || '').trim() || `http://${target.TARGET_HOST}/tttadmin`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:') return '';
    return url.toString().replace(/\/$/, '');
  } catch (_) { return ''; }
}

function targetUrl(baseUrl, pathname) {
  const base = new URL(baseUrl);
  return new URL(pathname, base.origin).toString();
}

function parseJson(response, fallback) {
  try { return JSON.parse(String(response?.body || '')); }
  catch (_) { throw new Error(fallback); }
}

function targetError(response, fallback) {
  const data = (() => { try { return JSON.parse(String(response?.body || '')); } catch (_) { return {}; } })();
  const error = new Error(String(data.message || data.msg || data.error || fallback));
  error.status = Number(response?.status) || 502;
  return error;
}

function create121BrowserClient({
  baseUrl = `http://${target.TARGET_HOST}/tttadmin`,
  httpClient = target.requestHttp,
  timeoutMs = Number(process.env.QIANTIE_121_CLIENT_TIMEOUT_MS) || 30_000,
  loginTimeoutMs = Number(process.env.QIANTIE_121_CLIENT_LOGIN_TIMEOUT_MS) || 30_000
} = {}) {
  const normalizedBase = normalizeTargetBaseUrl(baseUrl);
  if (!normalizedBase || typeof httpClient !== 'function') throw unavailableError();

  async function request(options, timeout = timeoutMs) {
    try { return await httpClient({ ...options, timeoutMs: timeout }); }
    catch (error) {
      const wrapped = unavailableError(`121 接口请求失败：${error?.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function login({ username, password } = {}) {
    const name = String(username || '').trim();
    const secret = typeof password === 'string' ? password : '';
    if (!name || !secret) throw new Error('请输入 121 用户名和密码');
    const loginPage = await request({ method: 'GET', url: targetUrl(normalizedBase, target.TARGET_LOGIN_PATH) }, loginTimeoutMs);
    const initialCookie = target.cookieHeaderFromSetCookie(loginPage.headers);
    const response = await request(target.buildLoginRequest(name, secret, initialCookie), loginTimeoutMs);
    if (Number(response.status) < 200 || Number(response.status) >= 300) throw targetError(response, '121 登录接口返回失败');
    const data = parseJson(response, '121 登录接口返回了无效数据');
    if (data.success !== true) throw new Error(String(data.message || data.msg || '121 登录失败'));
    const cookie = target.mergeCookieHeaders(initialCookie, target.cookieHeaderFromSetCookie(response.headers));
    if (!cookie) throw new Error('121 登录成功但未返回会话 Cookie');
    return { ok: true, status: 'ready', sessionKey: cookie };
  }

  async function test({ sessionKey } = {}) {
    const cookie = String(sessionKey || '').trim();
    if (!cookie) {
      const error = new Error('121 登录会话不存在，请重新登录');
      error.code = 'TARGET_SESSION_MISSING';
      error.status = 401;
      throw error;
    }
    const response = await request({ method: 'GET', url: targetUrl(normalizedBase, target.TARGET_CHECK_PATH), headers: { Cookie: cookie } });
    if (Number(response.status) >= 400 || target.isLoginPage(response.body)) {
      const error = new Error('121 登录会话已失效，请重新登录');
      error.code = 'TARGET_SESSION_EXPIRED';
      error.status = 401;
      throw error;
    }
    return { ok: true, status: 'ready', sessionKey: cookie };
  }

  async function action({ sessionKey, action, payload = {} } = {}) {
    const cookie = String(sessionKey || '').trim();
    if (!cookie) throw new Error('121 登录会话不存在，请重新登录');
    const headers = { Cookie: cookie };
    if (action === 'config_list') {
      const response = await request({ method: 'GET', url: targetUrl(normalizedBase, target.TARGET_CONFIG_LIST_PATH), headers });
      if (Number(response.status) >= 400) throw targetError(response, '121 配置档接口请求失败');
      return response;
    }
    if (action === 'organization_list') {
      const response = await request({ method: 'GET', url: targetUrl(normalizedBase, target.TARGET_ORGANIZATION_LIST_PATH), headers });
      if (Number(response.status) >= 400) throw targetError(response, '121 组织归属接口请求失败');
      return response;
    }
    if (action === 'dashboard') {
      const response = await request({ method: 'GET', url: targetUrl(normalizedBase, target.TARGET_CHECK_PATH), headers });
      if (Number(response.status) >= 400 || target.isLoginPage(response.body)) {
        const error = new Error('121 登录会话已失效，请重新登录');
        error.code = 'TARGET_SESSION_EXPIRED';
        error.status = 401;
        throw error;
      }
      return response;
    }
    if (action === 'book_list') {
      const response = await request({ method: 'GET', url: target.buildTargetBookListUrl(payload.bookId), headers });
      if (Number(response.status) >= 400) throw targetError(response, '121 书籍列表接口请求失败');
      return response;
    }
    if (action === 'upload') {
      const body = Buffer.from(String(payload.bodyBase64 || ''), 'base64');
      const response = await request({ method: 'POST', url: targetUrl(normalizedBase, target.TARGET_UPLOAD_PATH), headers: { ...headers, 'Content-Type': String(payload.contentType || 'multipart/form-data') }, body });
      if (Number(response.status) >= 400) throw targetError(response, '121 上传接口请求失败');
      return response;
    }
    throw new Error(`不支持的 121 接口操作：${String(action || '')}`);
  }

  return {
    configured: true,
    login,
    test,
    refresh: async () => { throw new Error('121 登录会话已失效，请重新输入账号密码'); },
    action,
    remove: async () => ({ ok: true })
  };
}

module.exports = { unavailableError, normalizeTargetBaseUrl, create121BrowserClient };
