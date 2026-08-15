export function getToken() {
  return localStorage.getItem('auth_token') || '';
}

export function setToken(token) {
  if (token) localStorage.setItem('auth_token', token);
  else localStorage.removeItem('auth_token');
}

function errorMessage(text, fallback) {
  try {
    const body = JSON.parse(text);
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // Non-JSON error responses are shown as returned by the server.
  }
  return text || fallback;
}

function notifyApiFailure({ path, method, status, message }) {
  if (path === '/api/client-errors') return;
  window.dispatchEvent(new CustomEvent('qiantie:api-error', {
    detail: {
      source: path,
      method: method || 'GET',
      status: Number.isInteger(status) ? status : 0,
      message: message || '请求失败，请稍后重试。'
    }
  }));
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    const failure = { kind: 'api-network', message: error?.message || 'Network request failed', stack: error?.stack, source: path, method: options.method || 'GET' };
    reportClientError(failure);
    notifyApiFailure({ ...failure, path });
    throw error;
  }
  if (response.status === 401 && path !== '/api/login') {
    const failure = { kind: 'api-response', message: '登录已失效，请重新登录', source: path, method: options.method || 'GET', status: response.status };
    reportClientError(failure);
    notifyApiFailure({ ...failure, path });
    // A slow request from an older account must never erase a newer session.
    // Notify before clearing so the layout can compare the request token with
    // the session that is currently active.
    if (getToken() === token) {
      window.dispatchEvent(new CustomEvent('qiantie:auth-expired', { detail: { token } }));
      setToken('');
      localStorage.removeItem('auth_username');
    }
    throw new Error('登录已失效，请重新登录');
  }
  const allowedStatuses = Array.isArray(options.allowStatuses) ? options.allowStatuses : [];
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const text = await response.text();
    const error = new Error(errorMessage(text, `请求失败：${response.status}`));
    const failure = { kind: 'api-response', message: error.message, stack: error.stack, source: path, method: options.method || 'GET', status: response.status };
    reportClientError(failure);
    notifyApiFailure({ ...failure, path });
    throw error;
  }
  if (options.responseType === 'blob') return response.blob();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}
import { reportClientError } from '../error-reporting';

export function listMyErrorLogs(limit = 100) {
  return apiRequest(`/api/client-errors/mine?limit=${encodeURIComponent(limit)}`);
}

export function listNovelPanelAiDiagnostics(limit = 100) {
  return apiRequest(`/api/novel-panel/diagnostics?limit=${encodeURIComponent(limit)}`);
}
