const https = require('https');

const YFAI_SEEDANCE_BASE_URL = 'https://yf.token6688.com';
const YFAI_SEEDANCE_MODEL = 'seedance-2-0-official';

function cleanBaseUrl(value) {
  return String(value || YFAI_SEEDANCE_BASE_URL).trim().replace(/\/$/, '');
}

function positiveInteger(value, fallback, { min, max }) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function seedanceDuration(value) {
  if (value === undefined || value === null || value === '') return 10;
  const duration = Number(value);
  if (!Number.isInteger(duration)) throw new Error('Seedance 时长必须是 4 到 15 秒的整数');
  if (duration < 4) throw new Error('Seedance 单次时长最短为 4 秒');
  if (duration > 15) throw new Error('超过 Seedance 单次 15 秒上限');
  return duration;
}

function buildYfaiSeedancePayload({ prompt, duration, resolution, aspectRatio, quality, imageUrls } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Seedance 视频提示词不能为空');
  const references = (Array.isArray(imageUrls) ? imageUrls : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 9);
  const params = {
    mode: references.length ? 'reference' : 'text-to-video',
    duration: String(seedanceDuration(duration)),
    resolution: ['480p', '720p', '1080p', '4k'].includes(String(resolution || '').trim()) ? String(resolution).trim() : '720p',
    aspect_ratio: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(String(aspectRatio || '').trim()) ? String(aspectRatio).trim() : '9:16',
    quality: ['标准', 'fast', 'mini'].includes(String(quality || '').trim()) ? String(quality).trim() : '标准',
    count: 1
  };
  if (references.length) params.images = references;
  return { model: YFAI_SEEDANCE_MODEL, prompt: text, params };
}

function jsonResponseRequest(url, { method = 'GET', apiKey, payload, timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const parsed = new URL(url);
    const request = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Seedance 视频服务响应超时')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function submitYfaiSeedance({ apiKey, payload, baseUrl = YFAI_SEEDANCE_BASE_URL, request = jsonResponseRequest } = {}) {
  return request(`${cleanBaseUrl(baseUrl)}/v1/media/generate`, { method: 'POST', apiKey, payload });
}

function requestYfaiSeedanceTask({ apiKey, taskId, baseUrl = YFAI_SEEDANCE_BASE_URL, request = jsonResponseRequest } = {}) {
  return request(`${cleanBaseUrl(baseUrl)}/v1/tasks/${encodeURIComponent(String(taskId || '').trim())}`, { method: 'GET', apiKey });
}

function parseJSON(text, fallback = {}) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseYfaiTaskResponse(body) {
  const payload = body && typeof body === 'object' ? body : parseJSON(body);
  const taskId = payload?.data?.task_id ?? payload?.data?.taskId ?? payload?.task_id ?? payload?.taskId;
  if (!String(taskId || '').trim()) throw new Error(String(payload?.msg || payload?.message || 'Seedance 未返回任务 ID'));
  return { taskId: String(taskId).trim() };
}

function parseYfaiTaskStatus(body) {
  const payload = body && typeof body === 'object' ? body : parseJSON(body);
  const status = String(payload?.status || payload?.data?.status || '').trim().toLowerCase();
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    return { status: 'failed', error: String(payload?.error || payload?.message || payload?.data?.error || 'Seedance 视频生成失败').trim() };
  }
  if (['completed', 'succeeded', 'success', 'done'].includes(status) || payload?.is_final === true) {
    const rawVideoUrl = String(payload?.output_url || payload?.url || payload?.result_url || payload?.data?.output_url || payload?.data?.url || '').trim();
    try {
      const parsed = new URL(rawVideoUrl);
      if (parsed.protocol !== 'https:') return { status: 'processing' };
      return { status: 'succeeded', videoUrl: parsed.toString() };
    } catch {
      return { status: 'processing' };
    }
  }
  return { status: 'processing' };
}

module.exports = {
  YFAI_SEEDANCE_BASE_URL,
  YFAI_SEEDANCE_MODEL,
  buildYfaiSeedancePayload,
  submitYfaiSeedance,
  requestYfaiSeedanceTask,
  parseYfaiTaskResponse,
  parseYfaiTaskStatus
};
