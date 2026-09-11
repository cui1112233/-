const https = require('node:https');
const { H3_NO_IMAGE_WORKFLOW, H3_REFERENCE_WORKFLOW, buildH3SubmitPayload, selectH3Workflow, usableReferenceImages } = require('./video-model-catalog');

const H3_API_BASE_URL = 'https://autodl.art';
const H3_RESULT_PATH = '/api/v1/comfyui/comfyui_workflow/result';
const MAX_H3_REFERENCE_IMAGES = 9;

function workflowPath(workflow) {
  if (![H3_NO_IMAGE_WORKFLOW, H3_REFERENCE_WORKFLOW].includes(workflow)) throw new Error('H3 workflow 不受支持');
  return `/api/v1/comfyui/comfyui_workflow/${workflow}`;
}

function buildH3Request({ prompt, duration, resolution, referenceImages } = {}) {
  const images = usableReferenceImages(referenceImages);
  if (images.length > MAX_H3_REFERENCE_IMAGES) throw new Error('H3 最多支持 9 张参考图片');
  const workflow = selectH3Workflow(images);
  return { workflow, path: workflowPath(workflow), body: buildH3SubmitPayload({ prompt, duration, resolution, referenceImages: images }) };
}

function payloadOf(body) { const payload = body?.data ?? body?.result ?? body; return payload && typeof payload === 'object' ? payload : {}; }
function readH3TaskID(body) { const payload = payloadOf(body); return String(payload.task_id ?? payload.taskId ?? payload.id ?? '').trim(); }
function h3TaskState(body) { const payload = payloadOf(body); return String(payload.status || payload.state || '').trim().toUpperCase(); }
function h3ResultURL(body) {
  for (const item of (Array.isArray(payloadOf(body).results) ? payloadOf(body).results : [])) {
    const candidate = typeof item === 'string' ? item : item?.url || item?.video_url || item?.videoUrl;
    try { const parsed = new URL(String(candidate || '').trim()); if (parsed.protocol === 'https:') return parsed.toString(); } catch {}
  }
  return '';
}

function transport({ apiKey, method, path, body, baseUrl = H3_API_BASE_URL } = {}) {
  const target = new URL(path, `${String(baseUrl).replace(/\/+$/, '')}/`);
  if (target.protocol !== 'https:') throw new Error('H3 服务地址必须使用 HTTPS');
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = https.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path: target.pathname + target.search, timeout: 90000, headers: { Accept: 'application/json', Authorization: String(apiKey || '').trim(), ...(requestBody ? { 'Content-Type': 'application/json', 'Content-Length': String(requestBody.length) } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') })); response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('H3 视频服务响应超时'))); request.on('error', reject); if (requestBody) request.write(requestBody); request.end();
  });
}

function defaultH3Submit({ apiKey, workflow, payload, baseUrl } = {}) { return transport({ apiKey, method: 'POST', path: workflowPath(workflow), body: payload, baseUrl }); }
function defaultH3Request({ apiKey, taskId, baseUrl } = {}) { return transport({ apiKey, method: 'GET', path: `${H3_RESULT_PATH}/${encodeURIComponent(String(taskId || '').trim())}`, baseUrl }); }

module.exports = { H3_API_BASE_URL, MAX_H3_REFERENCE_IMAGES, buildH3Request, defaultH3Request, defaultH3Submit, h3ResultURL, h3TaskState, readH3TaskID };
