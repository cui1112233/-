const https = require('node:https');

const FANKE_OPEN_VIDEO_MODEL_ID = 'fanke-open-video';
const FANKE_OPEN_VIDEO_BASE_URL = 'https://ai.fanke2026.xyz/api/open/v1';

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function strings(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function positiveIntegers(value) {
  return Array.isArray(value) ? value.map(Number).filter(item => Number.isInteger(item) && item > 0) : [];
}

function fankeEndpoint(path) {
  return new URL(String(path || '').replace(/^\/+/, ''), `${FANKE_OPEN_VIDEO_BASE_URL}/`);
}

function normalizeFankeVideoModel(value) {
  if (!value || value.type !== 'video' || value.status !== 'available') return null;
  const id = String(value.id || '').trim();
  if (!id) return null;
  return {
    id, name: String(value.name || id).trim(), durations: positiveIntegers(value.durations), resolutions: strings(value.resolutions),
    aspectRatios: strings(value.aspect_ratios), maxImageRefs: integerOrNull(value.max_image_refs),
    maxVideoRefs: integerOrNull(value.max_video_refs), maxAudioRefs: integerOrNull(value.max_audio_refs),
    promptMaxChars: integerOrNull(value.prompt_max_chars), audioRequiresImage: value.audio_requires_image === true
  };
}

function transport({ apiKey, path, headers, timeoutMs = 30000 } = {}) {
  const target = fankeEndpoint(path);
  return new Promise((resolve, reject) => {
    const request = https.request(target, { method: 'GET', timeout: timeoutMs, headers: headers || { Accept: 'application/json', Authorization: `Bearer ${String(apiKey || '').trim()}`, 'X-Public-Model-Ids': '1' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('梵客模型目录查询超时')));
    request.on('error', reject);
    request.end();
  });
}

function videoTransport({ apiKey, method = 'POST', path, payload, timeoutMs = 90000 } = {}) {
  const target = fankeEndpoint(path);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method,
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${String(apiKey || '').trim()}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('梵客视频服务响应超时')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function requestedOption(value, fallback, allowed, label) {
  const selected = String(value || fallback || '').trim();
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(selected)) {
    throw new Error(`所选梵客模型不支持${label}`);
  }
  return selected;
}

function buildFankeVideoPayload({ providerModel, prompt, duration, resolution, aspectRatio, imageUrls } = {}) {
  const model = providerModel && typeof providerModel === 'object' ? providerModel : {};
  const modelId = String(model.id || '').trim();
  const content = String(prompt || '').trim();
  if (!modelId) throw new Error('请选择梵客视频模型');
  if (!content) throw new Error('分镜视频提示词不能为空');
  if (Number.isInteger(Number(model.promptMaxChars)) && Number(model.promptMaxChars) > 0 && content.length > Number(model.promptMaxChars)) {
    throw new Error(`所选梵客模型提示词不能超过 ${model.promptMaxChars} 个字符`);
  }
  const durations = positiveIntegers(model.durations);
  const selectedDuration = Number(duration || durations[0] || 5);
  if (!Number.isInteger(selectedDuration) || selectedDuration <= 0 || (durations.length && !durations.includes(selectedDuration))) throw new Error('所选梵客模型不支持该视频时长');
  const selectedResolution = requestedOption(resolution, strings(model.resolutions)[0], strings(model.resolutions), '该分辨率');
  const selectedRatio = requestedOption(aspectRatio, strings(model.aspectRatios)[0] || '9:16', strings(model.aspectRatios), '该画面比例');
  const references = Array.isArray(imageUrls) ? imageUrls.map(item => String(item || '').trim()).filter(Boolean) : [];
  const maxImageRefs = integerOrNull(model.maxImageRefs);
  if (maxImageRefs !== null && references.length > maxImageRefs) throw new Error(`所选梵客模型最多支持 ${maxImageRefs} 张参考图片`);
  return {
    model: modelId,
    prompt: content,
    ratio: selectedRatio,
    duration: selectedDuration,
    ...(selectedResolution ? { resolution: selectedResolution } : {}),
    ...(references.length ? { imageUrls: references } : {})
  };
}

function parseFankeVideoSubmission(text) {
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('梵客视频服务返回了无法识别的响应'); }
  const jobId = String(body?.jobId || body?.data?.jobId || '').trim();
  if (body?.success !== true || !jobId) throw new Error(String(body?.errorMessage || body?.message || '梵客视频服务未返回任务 ID'));
  return { jobId };
}

function parseFankeVideoStatus(text) {
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('梵客视频任务状态返回了无法识别的响应'); }
  const status = String(body?.status || body?.data?.status || '').trim().toLowerCase();
  if (['submitted', 'queued', 'processing', 'running'].includes(status)) return { status: 'processing' };
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status) || body?.success === false) return { status: 'failed', error: String(body?.errorMessage || body?.message || '梵客视频生成失败') };
  const videoUrl = String(body?.videoUrl || body?.data?.videoUrl || '').trim();
  if (['succeeded', 'success', 'completed', 'done'].includes(status) && /^https:\/\//.test(videoUrl)) return { status: 'succeeded', videoUrl };
  throw new Error('梵客视频任务返回了无法识别的状态');
}

function submitFankeVideo({ apiKey, payload } = {}) {
  return videoTransport({ apiKey, method: 'POST', path: '/video/generate', payload });
}

function requestFankeVideoTask({ apiKey, taskId } = {}) {
  return videoTransport({ apiKey, method: 'GET', path: `/video/status?jobId=${encodeURIComponent(String(taskId || '').trim())}` });
}

async function fetchFankeVideoModels({ apiKey, request = transport } = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请填写梵客视频 API Key');
  const reply = await request({ apiKey, path: '/models', headers: { Accept: 'application/json', Authorization: `Bearer ${String(apiKey).trim()}`, 'X-Public-Model-Ids': '1' } });
  if (reply.statusCode < 200 || reply.statusCode >= 300) throw new Error(`梵客模型目录请求失败（HTTP ${reply.statusCode}）`);
  let body;
  try { body = JSON.parse(reply.text); } catch { throw new Error('梵客模型目录返回了无法识别的响应'); }
  return (Array.isArray(body?.data) ? body.data : []).map(normalizeFankeVideoModel).filter(Boolean);
}

module.exports = {
  FANKE_OPEN_VIDEO_MODEL_ID,
  FANKE_OPEN_VIDEO_BASE_URL,
  fankeEndpoint,
  fetchFankeVideoModels,
  normalizeFankeVideoModel,
  buildFankeVideoPayload,
  parseFankeVideoSubmission,
  parseFankeVideoStatus,
  submitFankeVideo,
  requestFankeVideoTask
};
