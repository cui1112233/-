import { apiRequest } from './client.js';

const JOBS_PATH = '/api/shuihuo-production/giant-material-jobs';
const EXECUTORS_PATH = '/api/shuihuo-production/giant-material-executors';

export function createGiantMaterialPairing(platform = 'giant_material') {
  return apiRequest('/api/shuihuo-production/giant-material-executor/pairings', {
    method: 'POST',
    body: JSON.stringify({ platform })
  });
}

export function listGiantMaterialExecutors() {
  return apiRequest(EXECUTORS_PATH);
}

export function createGiantMaterialJob(payload = {}) {
  return apiRequest(JOBS_PATH, { method: 'POST', body: JSON.stringify({
    platform: 'giant_material',
    materialId: String(payload.materialId || '').trim(),
    platformBookId: String(payload.platformBookId || '').trim(),
    title: String(payload.title || '').trim(),
    videoUrl: String(payload.videoUrl || '').trim(),
    durationSeconds: Number(payload.durationSeconds || 0),
    modelVersion: String(payload.modelVersion || 'windows-paddleocr-v1').trim(),
    contentRangeLines: String(payload.contentRangeLines || '').trim()
  }) });
}

export function getGiantMaterialJob(jobId) {
  return apiRequest(`${JOBS_PATH}/${encodeURIComponent(jobId)}`);
}

export function cancelGiantMaterialJob(jobId) {
  return apiRequest(`${JOBS_PATH}/${encodeURIComponent(jobId)}/cancel`, { method: 'PUT', body: '{}' });
}

export async function waitForGiantMaterialJob(jobId, { signal, onState = () => {}, intervalMs = 1000, maxPolls = 3600 } = {}) {
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const response = await getGiantMaterialJob(jobId);
    const job = response?.job || response?.data?.job || response;
    onState(job);
    if (['succeeded', 'failed', 'cancelled'].includes(String(job?.state || '').toLowerCase())) return job;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('The operation was aborted', 'AbortError')); }, { once: true });
    });
  }
  throw new Error('GIANT_EXECUTOR_TIMEOUT');
}
