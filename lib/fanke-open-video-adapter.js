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
  const target = new URL(path, `${FANKE_OPEN_VIDEO_BASE_URL}/`);
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

async function fetchFankeVideoModels({ apiKey, request = transport } = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请填写梵客视频 API Key');
  const reply = await request({ apiKey, path: '/models', headers: { Accept: 'application/json', Authorization: `Bearer ${String(apiKey).trim()}`, 'X-Public-Model-Ids': '1' } });
  if (reply.statusCode < 200 || reply.statusCode >= 300) throw new Error(`梵客模型目录请求失败（HTTP ${reply.statusCode}）`);
  let body;
  try { body = JSON.parse(reply.text); } catch { throw new Error('梵客模型目录返回了无法识别的响应'); }
  return (Array.isArray(body?.data) ? body.data : []).map(normalizeFankeVideoModel).filter(Boolean);
}

module.exports = { FANKE_OPEN_VIDEO_MODEL_ID, FANKE_OPEN_VIDEO_BASE_URL, fetchFankeVideoModels, normalizeFankeVideoModel };
