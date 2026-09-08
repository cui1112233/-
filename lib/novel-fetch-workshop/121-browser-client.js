function unavailableError(message = '浏览器登录服务不可用：未配置 Browser Worker') {
  const error = new Error(message);
  error.code = 'BROWSER_WORKER_UNAVAILABLE';
  error.recoverable = false;
  return error;
}

function normalizeWorkerBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch (_) { return ''; }
}

function create121BrowserClient({
  baseUrl = process.env.QIANTIE_121_BROWSER_WORKER_URL || '',
  secret = process.env.QIANTIE_121_WORKER_SECRET || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.QIANTIE_121_CLIENT_TIMEOUT_MS) || 40_000,
  loginTimeoutMs = Number(process.env.QIANTIE_121_CLIENT_LOGIN_TIMEOUT_MS) || 55_000
} = {}) {
  const workerBase = normalizeWorkerBaseUrl(baseUrl);
  // Treat the internal auth secret as opaque. The Browser Worker compares the
  // x-qiantie-internal-secret header byte-for-byte, so mutating it here (for
  // example with trim()) can turn an otherwise identical configured secret
  // into a 401 unauthorized on the wire.
  const internalSecret = String(secret || '');
  const hasInternalSecret = Boolean(internalSecret.trim());

  async function request(path, { method = 'POST', body, requestTimeoutMs = timeoutMs } = {}) {
    if (!workerBase || !hasInternalSecret || typeof fetchImpl !== 'function') throw unavailableError();
    const controller = new AbortController();
    const timeout = Math.max(1000, Math.min(Number(requestTimeoutMs) || 40_000, 60000));
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let response;
      try {
        response = await fetchImpl(`${workerBase}${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-qiantie-internal-secret': internalSecret },
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          const timeoutError = new Error('浏览器登录服务请求超时');
          timeoutError.code = 'BROWSER_WORKER_TIMEOUT';
          timeoutError.recoverable = false;
          throw timeoutError;
        }
        const unavailable = unavailableError(`浏览器登录服务不可用：${error?.message || String(error)}`);
        unavailable.cause = error;
        throw unavailable;
      }
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
      if (!response.ok) {
        const error = new Error(`浏览器登录服务失败：${data.detail || data.error || data.raw || `HTTP ${response.status}`}`);
        error.code = data.error || 'BROWSER_WORKER_ERROR';
        error.status = response.status;
        error.recoverable = false;
        error.workerResponse = data;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured: Boolean(workerBase && hasInternalSecret),
    login: input => request('/session/login', { body: input, requestTimeoutMs: loginTimeoutMs }),
    test: input => request('/session/test', { body: input }),
    refresh: input => request('/session/refresh', { body: input, requestTimeoutMs: loginTimeoutMs }),
    action: input => request('/session/action', { body: input }),
    remove: input => request('/session', { method: 'DELETE', body: input })
  };
}

module.exports = { unavailableError, normalizeWorkerBaseUrl, create121BrowserClient };
