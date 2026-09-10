const express = require('express');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { apiAuth } = require('../middleware/auth');
const { readConfig } = require('../lib/shared');

const YD_CREATE_URL = 'https://ydapi.yadiai.cn/openapi/v1/video/create';
const YD_TASKS_URL = 'https://ydapi.yadiai.cn/openapi/v1/video/tasks';
const DEFAULT_FIRST_FRAME_URL = 'https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png';
const MAX_PROMPT_LENGTH = 12000;
const MAX_OPTIONAL_IMAGES = 3;
const SUPPORTED_SCRIPT_VIDEO_MODEL_KEYS = new Set(['yd2-mini-video', 'local-doubao-executor-video']);

function isSupportedScriptVideoModel(modelKey) {
  return SUPPORTED_SCRIPT_VIDEO_MODEL_KEYS.has(String(modelKey || '').trim());
}

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

function upstreamRequest(url, apiKey) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', timeout: 30000, headers: { Authorization: `Bearer ${apiKey}` } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 500, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('视频服务响应超时')));
    request.on('error', reject);
    request.end();
  });
}

function payloadOf(body) {
  const payload = body?.data ?? body?.result ?? body;
  return payload && typeof payload === 'object' ? payload : {};
}

function taskState(body) {
  const payload = payloadOf(body);
  const nested = payload.task && typeof payload.task === 'object' ? payload.task : {};
  return String(payload.status || payload.state || nested.status || nested.state || '').trim().toUpperCase();
}

function taskError(body) {
  const payload = payloadOf(body);
  const nested = payload.task && typeof payload.task === 'object' ? payload.task : {};
  return String(payload.errorMessage || payload.error || payload.message || nested.errorMessage || nested.error || nested.message || '视频生成失败').trim();
}

function resultURL(body) {
  const payload = payloadOf(body);
  const candidates = [
    ...(Array.isArray(payload.urls) ? payload.urls : []),
    ...(Array.isArray(payload.outputs) ? payload.outputs.map(item => item?.url) : []),
    payload.url, payload.video_url, payload.videoUrl
  ];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate || '').trim());
      if (parsed.protocol === 'https:') return parsed.toString();
    } catch { /* ignore malformed result URLs */ }
  }
  return '';
}

function bridgeJSON(gateway, account, method, pathname, payload) {
  const target = new URL(gateway?.targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = gateway?.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', secret).update([account.username, issuedAt, String(account.isOwner === true), method, pathname].join('\n')).digest('hex');
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path: pathname, headers: { Accept:'application/json','X-Qiantie-Username':account.username,'X-Qiantie-Is-Owner':String(account.isOwner===true),'X-Qiantie-Issued-At':issuedAt,'X-Qiantie-Signature':signature,...(body?{'Content-Type':'application/json','Content-Length':String(body.length)}:{}) } }, response => { const chunks=[]; response.on('data',chunk=>chunks.push(chunk)); response.on('end',()=>{ let data={}; try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}; if((response.statusCode||500)>=400){const error=new Error(data.error||'本地执行器服务不可用');error.status=response.statusCode;return reject(error)} resolve(data) }) });
    request.on('error',()=>reject(Object.assign(new Error('本地执行器服务暂不可用'),{status:503}))); if(body)request.write(body); request.end();
  });
}

function bridgeDownload(gateway, account, pathname, res) {
  const target = new URL(gateway?.targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000'); const secret = gateway?.bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me'; const issuedAt=String(Math.floor(Date.now()/1000)); const signature=crypto.createHmac('sha256',secret).update([account.username,issuedAt,String(account.isOwner===true),'GET',pathname].join('\n')).digest('hex'); const transport=target.protocol==='https:'?https:http;
  const upstream=transport.request({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method:'GET',path:pathname,headers:{'X-Qiantie-Username':account.username,'X-Qiantie-Is-Owner':String(account.isOwner===true),'X-Qiantie-Issued-At':issuedAt,'X-Qiantie-Signature':signature}},response=>{res.status(response.statusCode||502); if(response.headers['content-type'])res.setHeader('Content-Type',response.headers['content-type']); response.pipe(res)}); upstream.on('error',()=>res.status(503).json({error:'视频下载服务暂不可用'})); upstream.end();
}

function createScriptVideoRouter({ configReader = readConfig, submit = defaultSubmit, request = upstreamRequest, shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);
  router.post('/', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '分镜视频提示词不能为空' });
    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `分镜视频提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符` });
    const modelKey = String(req.body?.modelKey || 'yd2-mini-video').trim();
    if (modelKey === 'local-doubao-executor-video') {
      try { return res.status(202).json(await bridgeJSON(shuihuoGateway, req.auth.account, 'POST', '/api/script-videos/local', { prompt })); }
      catch (error) { return res.status(error.status || 503).json({ error: error.message || '本地执行器任务提交失败' }); }
    }
    if (!isSupportedScriptVideoModel(modelKey)) return res.status(409).json({ error: '当前视频模型已配置，但尚未接入统一视频提交接口' });
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
  router.get('/:taskId', async (req, res) => {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ error: '视频任务 ID 不能为空' });
    try {
      const local = await bridgeJSON(shuihuoGateway, req.auth.account, 'GET', `/api/script-videos/${encodeURIComponent(taskId)}`);
      return res.json(local);
    } catch (error) {
      if (error.status !== 404) return res.status(error.status || 503).json({ error: error.message || '本地执行器任务状态查询失败' });
    }
    const apiKey = String(configReader(req.username)?.video?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: '请先在设置中保存视频生成 API Key' });
    try {
      const statusReply = await request(`${YD_TASKS_URL}/${encodeURIComponent(taskId)}`, apiKey);
      if (statusReply.statusCode < 200 || statusReply.statusCode >= 300) return res.status(502).json({ error: '视频任务状态查询失败' });
      const statusBody = JSON.parse(statusReply.text);
      const state = taskState(statusBody);
      if (['QUEUED', 'SUBMITTED', 'RUNNING', 'PENDING'].includes(state)) return res.json({ ok: true, taskId, status: 'processing' });
      if (state === 'FAILED') return res.json({ ok: true, taskId, status: 'failed', error: taskError(statusBody) });
      if (state !== 'SUCCESS') return res.status(502).json({ error: '视频服务返回了无法识别的任务状态' });
      const resultReply = await request(`${YD_TASKS_URL}/${encodeURIComponent(taskId)}/result`, apiKey);
      if (resultReply.statusCode < 200 || resultReply.statusCode >= 300) return res.status(502).json({ error: '视频结果获取失败' });
      const videoUrl = resultURL(JSON.parse(resultReply.text));
      if (!videoUrl) return res.status(502).json({ error: '视频服务未返回可播放地址' });
      return res.json({ ok: true, taskId, status: 'succeeded', videoUrl });
    } catch (error) {
      return res.status(502).json({ error: error?.message === '视频服务响应超时' ? error.message : '视频任务状态暂不可用，请稍后重试' });
    }
  });
  router.get('/:taskId/download', (req, res) => bridgeDownload(shuihuoGateway, req.auth.account, `/api/script-videos/${encodeURIComponent(String(req.params.taskId || ''))}/download`, res));
  return router;
}

module.exports = { createScriptVideoRouter, DEFAULT_FIRST_FRAME_URL, validOptionalImageURLs, readTaskID, taskState, resultURL, isSupportedScriptVideoModel };
