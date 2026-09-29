'use strict';

function workerError(data, status) {
  const body = data && typeof data === 'object' ? data : {};
  const error = new Error(String(body.detail || body.error || `121 Browser Worker HTTP ${status}`));
  error.workerResponse = body;
  error.status = Number(status) || 502;
  if (status === 401 && body.error === 'unauthorized') {
    error.code = 'BROWSER_WORKER_UNAUTHORIZED';
    error.status = 503;
  } else if (body.error === 'session_expired' || body.status === 'expired') {
    error.code = 'session_expired';
    error.status = 401;
  } else if (body.error === 'browser_timeout') {
    error.code = 'BROWSER_WORKER_TIMEOUT';
    error.status = 503;
  } else if (body.error === 'action_failed') {
    error.code = 'BROWSER_WORKER_ACTION_FAILED';
  }
  return error;
}

function create121BrowserWorkerClient({
  baseUrl = process.env.QIANTIE_121_BROWSER_WORKER_URL,
  secret = process.env.QIANTIE_121_WORKER_SECRET,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.QIANTIE_121_WORKER_REQUEST_TIMEOUT_MS) || 210_000
} = {}) {
  const endpoint = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!endpoint || !secret || typeof fetchImpl !== 'function') {
    const error = new Error('121 Browser Worker 未配置');
    error.code = 'BROWSER_WORKER_UNAVAILABLE';
    throw error;
  }

  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 60_000));
    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-qiantie-internal-secret': secret },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw workerError(data, response.status);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('121 Browser Worker 请求超时');
        timeout.code = 'BROWSER_WORKER_TIMEOUT';
        timeout.status = 503;
        throw timeout;
      }
      if (error?.code) throw error;
      const unavailable = new Error(`121 Browser Worker 请求失败：${error?.message || String(error)}`);
      unavailable.code = 'BROWSER_WORKER_UNAVAILABLE';
      unavailable.status = 503;
      unavailable.cause = error;
      throw unavailable;
    } finally {
      clearTimeout(timer);
    }
  }

  const client = {
    configured: true,
    login: input => request('/session/login', input),
    test: input => request('/session/test', input),
    action: async input => {
      const result = await request('/session/action', input);
      return {
        status: result.targetStatus,
        headers: result.headers || {},
        body: String(result.body || ''),
        storageState: undefined,
        sessionKey: result.sessionKey
      };
    },
    refresh: input => request('/session/refresh', input),
    remove: input => request('/session', input)
  };
  return client;
}

module.exports = { create121BrowserWorkerClient };
