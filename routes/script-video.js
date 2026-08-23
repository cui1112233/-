const express = require('express');
const https = require('https');
const { apiAuth } = require('../middleware/auth');
const { readConfig } = require('../lib/shared');

const YD_CREATE_URL = 'https://ydapi.yadiai.cn/openapi/v1/video/create';
const DEFAULT_FIRST_FRAME_URL = 'https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png';
const MAX_PROMPT_LENGTH = 12000;
const MAX_OPTIONAL_IMAGES = 3;

function readTaskID(payload) {
  const candidates = [payload?.task_id, payload?.taskId, payload?.id, payload?.data?.task_id, payload?.data?.taskId, payload?.data?.id, payload?.result?.task_id, payload?.result?.taskId];
  const value = candidates.find(item => typeof item === 'string' || typeof item === 'number');
  return value === undefined ? '' : String(value).trim();
}

function validOptionalImageURLs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OPTIONAL_IMAGES) throw new Error('可选图片最多 3 张');
  return value.map(item => {
    const imageURL = String(item || '').trim();
    if (!imageURL) throw new Error('可选图片地址不能为空');
    const parsed = new URL(imageURL);
    if (parsed.protocol !== 'https:') throw new Error('可选图片必须使用 HTTPS 地址');
    return parsed.toString();
  });
}

function defaultSubmit({ apiKey, payload }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(YD_CREATE_URL, { method: 'POST', timeout: 90000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${apiKey}` } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('视频服务响应超时')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function createScriptVideoRouter({ configReader = readConfig, submit = defaultSubmit } = {}) {
  const router = express.Router();
  router.use(apiAuth);
  router.post('/', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '分镜视频提示词不能为空' });
    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `分镜视频提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符` });
    let imageUrls;
    try { imageUrls = validOptionalImageURLs(req.body?.imageUrls); } catch (error) { return res.status(400).json({ error: error.message || '可选图片参数不正确' }); }
    const apiKey = String(configReader(req.username)?.video?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: '请先在设置中保存视频生成 API Key' });
    try {
      const upstream = await submit({ apiKey, payload: { model: 'yd2.0-mini', prompt, image_urls: [DEFAULT_FIRST_FRAME_URL, ...imageUrls], duration: '1', aspect_ratio: '9:16', resolution: '720p' } });
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) return res.status(502).json({ error: `视频服务请求失败（HTTP ${upstream.statusCode}）` });
      let body;
      try { body = JSON.parse(upstream.text); } catch { return res.status(502).json({ error: '视频服务返回了无法识别的响应' }); }
      const taskId = readTaskID(body);
      if (!taskId) return res.status(502).json({ error: '视频服务未返回任务 ID' });
      return res.status(202).json({ ok: true, taskId });
    } catch (error) {
      return res.status(502).json({ error: error?.message === '视频服务响应超时' ? error.message : '视频服务暂不可用，请稍后重试' });
    }
  });
  return router;
}

module.exports = { createScriptVideoRouter, DEFAULT_FIRST_FRAME_URL, validOptionalImageURLs, readTaskID };
