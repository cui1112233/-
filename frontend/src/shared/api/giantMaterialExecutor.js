const DEFAULT_BASE_URL = 'http://127.0.0.1:17861';

export function normalizeGiantMaterialExecutorStatus(value) {
  if (!value || value.online === false) return { kind: 'offline', label: '执行器未安装或未启动' };
  if (value.state === 'downloading_model' || value.modelReady === false) return { kind: 'downloading_model', label: '正在下载 OCR 模型' };
  if (value.state === 'running' || value.state === 'cleaning' || value.state === 'uploading') return { kind: 'running', label: '正在 OCR' };
  if (value.state === 'failed') return { kind: 'failed', label: value.errorMessage || 'OCR 失败' };
  return { kind: 'ready', label: '执行器已就绪' };
}

export function createGiantMaterialExecutorClient({ baseUrl = DEFAULT_BASE_URL, nonce = '', fetchImpl = fetch } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');

  async function request(path, { method = 'GET', body, signal } = {}) {
    const headers = { Accept: 'application/json' };
    if (nonce) headers['X-Giant-Executor-Nonce'] = nonce;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.code || `HTTP_${response.status}`);
    return payload;
  }

  return {
    async health(options = {}) {
      try {
        return await request('/v1/health', options);
      } catch (error) {
        if (error?.name === 'TypeError' || String(error?.message || '').includes('Failed to fetch')) return null;
        throw error;
      }
    },
    capabilities(options = {}) {
      return request('/v1/capabilities', options);
    },
    pair(code, options = {}) {
      return request('/v1/pair', { ...options, method: 'POST', body: { code } });
    },
    startJob(jobId, options = {}) {
      return request('/v1/jobs', { ...options, method: 'POST', body: { jobId } });
    },
    job(jobId, options = {}) {
      return request(`/v1/jobs/${encodeURIComponent(jobId)}`, options);
    },
    cancel(jobId, options = {}) {
      return request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { ...options, method: 'POST', body: {} });
    },
  };
}

export { DEFAULT_BASE_URL };
