const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { resolveTeamAuthorization } = require('../lib/api-access');
const {
  LOCAL_EXECUTOR_VIDEO_MODEL,
  buildLocalVideoPayload,
  localTaskView,
  localMediaView,
  artifactIdFromLocalMediaId
} = require('../lib/local-executor-shuihuo');

const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

function signBridgeRequest(secret, { username, isOwner, issuedAt, method, pathname }) {
  const payload = [username, issuedAt, String(isOwner), method, pathname].join('\n');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function bridgeJSONRequest({ target, secret, transport, username, isOwner, method = 'GET', pathname, body, allowStatuses = [] }) {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const encoded = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
  const headers = {
    'X-Qiantie-Username': username,
    'X-Qiantie-Is-Owner': String(isOwner),
    'X-Qiantie-Issued-At': issuedAt,
    'X-Qiantie-Signature': signBridgeRequest(secret, { username, isOwner, issuedAt, method, pathname }),
    Accept: 'application/json'
  };
  if (encoded) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(encoded.length);
  }
  return new Promise((resolve, reject) => {
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: pathname,
      headers,
      timeout: 15_000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        if (text) {
          try { parsed = JSON.parse(text); } catch {
            const error = new Error('水货生产服务返回了无法解析的数据');
            error.status = 502;
            return reject(error);
          }
        }
        const status = response.statusCode || 502;
        if ((status < 200 || status >= 300) && !allowStatuses.includes(status)) {
          const error = new Error(parsed?.error || `水货生产服务请求失败（${status}）`);
          error.status = status;
          error.body = parsed;
          return reject(error);
        }
        resolve({ status, body: parsed, headers: response.headers });
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('水货生产服务响应超时')));
    upstream.on('error', error => {
      error.status = error.status || 503;
      reject(error);
    });
    if (encoded) upstream.write(encoded);
    upstream.end();
  });
}

function createLocalExecutorShuihuoRouter({ targetBaseUrl, bridgeSecret, taskStore, memberStore, usageStore } = {}) {
  if (!taskStore) throw new Error('taskStore is required');
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;
  const router = express.Router();

  router.use(apiAuth);

  function identity(req) {
    return { username: req.auth.account.username, isOwner: req.auth.account.isOwner === true };
  }

  function requireVideoAccess(req, res) {
    if (!memberStore || !usageStore) return true;
    try {
      resolveTeamAuthorization({ memberStore, usageStore, username: req.username, scope: 'image' });
      return true;
    } catch (error) {
      res.status(error?.status || 403).json({ error: error?.message || '当前账号没有视频生成权限', ...(error?.code ? { code: error.code } : {}) });
      return false;
    }
  }

  async function getLocalJob(req, localJobId) {
    const { username, isOwner } = identity(req);
    return (await bridgeJSONRequest({
      target, secret, transport, username, isOwner,
      pathname: `/api/shuihuo-production/local-executor-jobs/${encodeURIComponent(localJobId)}`
    })).body;
  }

  async function createLocalJob(req, { projectId, segment, sourceTaskId, videoSettings = {} }) {
    const { username, isOwner } = identity(req);
    const payload = buildLocalVideoPayload({ projectId, segment, videoSettings });
    const job = (await bridgeJSONRequest({
      target, secret, transport, username, isOwner,
      method: 'POST', pathname: '/api/shuihuo-production/local-executor-jobs',
      body: { sourceTaskId, platform: 'doubao', payload }
    })).body;
    const mapping = taskStore.upsert(username, {
      sourceTaskId,
      localJobId: job.id,
      projectId: Number(projectId),
      segmentId: Number(segment.id),
      modelId: LOCAL_EXECUTOR_VIDEO_MODEL.id,
      payload
    });
    return { mapping, job };
  }

  async function getProject(req, projectId) {
    const { username, isOwner } = identity(req);
    return bridgeJSONRequest({
      target, secret, transport, username, isOwner,
      pathname: `/api/shuihuo-production/projects/${encodeURIComponent(projectId)}`
    });
  }

  async function localViews(req, projectId) {
    const username = identity(req).username;
    const mappings = taskStore.list(username, projectId);
    return Promise.all(mappings.map(async mapping => {
      try {
        const job = await getLocalJob(req, mapping.localJobId);
        return { mapping, job };
      } catch {
        return {
          mapping,
          job: {
            id: mapping.localJobId,
            state: 'queued',
            errorCode: 'LOCAL_EXECUTOR_STATUS_UNAVAILABLE',
            errorMessage: '本地执行器状态暂时无法读取'
          }
        };
      }
    }));
  }

  router.get('/health', async (req, res) => {
    try {
      const { username, isOwner } = identity(req);
      const upstream = await bridgeJSONRequest({
        target, secret, transport, username, isOwner,
        pathname: '/api/shuihuo-production/health', allowStatuses: [503]
      });
      const kinds = new Set(Array.isArray(upstream.body?.enabledModelKinds) ? upstream.body.enabledModelKinds : []);
      kinds.add('video');
      return res.status(upstream.status).json({ ...upstream.body, enabledModelKinds: [...kinds], localExecutorVideoReady: true });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message || '读取生产状态失败' });
    }
  });

  router.get('/models', async (req, res) => {
    try {
      const { username, isOwner } = identity(req);
      const upstream = await bridgeJSONRequest({ target, secret, transport, username, isOwner, pathname: '/api/shuihuo-production/models' });
      const models = (Array.isArray(upstream.body?.models) ? upstream.body.models : [])
        .filter(model => Number(model?.id) !== LOCAL_EXECUTOR_VIDEO_MODEL.id);
      models.push(LOCAL_EXECUTOR_VIDEO_MODEL);
      return res.status(upstream.status).json({ ...upstream.body, models });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message || '读取模型列表失败' });
    }
  });

  router.post('/projects/:projectId/tasks', async (req, res, next) => {
    if (Number(req.body?.modelId) !== LOCAL_EXECUTOR_VIDEO_MODEL.id || req.body?.kind !== 'video') return next();
    if (!requireVideoAccess(req, res)) return;
    try {
      const projectId = Number(req.params.projectId);
      const projectResult = await getProject(req, projectId);
      const segment = (projectResult.body?.segments || []).find(item => Number(item?.id) === Number(req.body?.segmentId));
      if (!segment) return res.status(404).json({ error: '分镜不存在' });
      if (segment.confirmed === false) return res.status(409).json({ error: '请先确认分镜' });
      const sourceTaskId = `lev_${crypto.randomBytes(12).toString('base64url')}`;
      const { mapping, job } = await createLocalJob(req, { projectId, segment, sourceTaskId, videoSettings: req.body?.videoSettings || {} });
      return res.status(201).json({ task: localTaskView(mapping, job) });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || '创建豆包本地视频任务失败' });
    }
  });

  router.post('/projects/:projectId/tasks/batch', async (req, res, next) => {
    if (Number(req.body?.modelId) !== LOCAL_EXECUTOR_VIDEO_MODEL.id || req.body?.kind !== 'video') return next();
    if (!requireVideoAccess(req, res)) return;
    try {
      const projectId = Number(req.params.projectId);
      const projectResult = await getProject(req, projectId);
      const segments = Array.isArray(projectResult.body?.segments) ? projectResult.body.segments : [];
      const requested = Array.isArray(req.body?.segmentIds) ? req.body.segmentIds : [];
      const results = [];
      for (const segmentId of requested) {
        const segment = segments.find(item => Number(item?.id) === Number(segmentId));
        if (!segment) { results.push({ segmentId, error: '分镜不存在' }); continue; }
        if (segment.confirmed === false) { results.push({ segmentId, error: '分镜未确认' }); continue; }
        try {
          const sourceTaskId = `lev_${crypto.randomBytes(12).toString('base64url')}`;
          const created = await createLocalJob(req, { projectId, segment, sourceTaskId, videoSettings: req.body?.videoSettings || {} });
          results.push({ segmentId, task: localTaskView(created.mapping, created.job) });
        } catch (error) {
          results.push({ segmentId, error: error.message || '创建本地视频任务失败' });
        }
      }
      return res.status(200).json({ results });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || '批量创建豆包本地视频任务失败' });
    }
  });

  router.get('/projects/:projectId/tasks', async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      const { username, isOwner } = identity(req);
      const upstream = await bridgeJSONRequest({
        target, secret, transport, username, isOwner,
        pathname: `/api/shuihuo-production/projects/${encodeURIComponent(projectId)}/tasks`
      });
      const local = await localViews(req, projectId);
      const localTasks = local.map(({ mapping, job }) => localTaskView(mapping, job));
      return res.status(upstream.status).json({ ...upstream.body, tasks: [...localTasks, ...(upstream.body?.tasks || [])] });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message || '读取任务中心失败' });
    }
  });

  router.get('/projects/:projectId', async (req, res) => {
    try {
      const projectId = Number(req.params.projectId);
      const upstream = await getProject(req, projectId);
      const local = await localViews(req, projectId);
      const localMedia = local.map(({ mapping, job }) => localMediaView(mapping, job)).filter(Boolean);
      return res.status(upstream.status).json({ ...upstream.body, media: [...localMedia, ...(upstream.body?.media || [])] });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message || '读取项目失败' });
    }
  });

  router.put('/tasks/:taskId/cancel', async (req, res, next) => {
    const username = identity(req).username;
    const mapping = taskStore.find(username, req.params.taskId);
    if (!mapping) return next();
    if (!requireVideoAccess(req, res)) return;
    try {
      const { isOwner } = identity(req);
      const job = (await bridgeJSONRequest({
        target, secret, transport, username, isOwner,
        method: 'PUT', pathname: `/api/shuihuo-production/local-executor-jobs/${encodeURIComponent(mapping.localJobId)}/cancel`, body: {}
      })).body;
      return res.json({ task: localTaskView(mapping, job) });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || '取消本地视频任务失败' });
    }
  });

  router.post('/tasks/:taskId/retry', async (req, res, next) => {
    const username = identity(req).username;
    const mapping = taskStore.find(username, req.params.taskId);
    if (!mapping) return next();
    if (!requireVideoAccess(req, res)) return;
    try {
      const { isOwner } = identity(req);
      const job = (await bridgeJSONRequest({
        target, secret, transport, username, isOwner,
        method: 'POST', pathname: '/api/shuihuo-production/local-executor-jobs',
        body: { sourceTaskId: mapping.sourceTaskId, platform: 'doubao', payload: mapping.payload || {} }
      })).body;
      const nextMapping = taskStore.upsert(username, { ...mapping, localJobId: job.id });
      return res.status(201).json({ task: localTaskView(nextMapping, job) });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || '重试本地视频任务失败' });
    }
  });

  router.get('/media/:mediaId/download', async (req, res, next) => {
    const artifactId = artifactIdFromLocalMediaId(req.params.mediaId);
    if (!artifactId) return next();
    const { username, isOwner } = identity(req);
    const pathname = `/api/shuihuo-production/local-executor-artifacts/${encodeURIComponent(artifactId)}`;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const headers = {
      'X-Qiantie-Username': username,
      'X-Qiantie-Is-Owner': String(isOwner),
      'X-Qiantie-Issued-At': issuedAt,
      'X-Qiantie-Signature': signBridgeRequest(secret, { username, isOwner, issuedAt, method: 'GET', pathname }),
      Accept: 'video/mp4'
    };
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: 'GET', path: pathname, headers, timeout: 60_000
    }, response => {
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
      }
      res.status(response.statusCode || 502);
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('本地视频读取超时')));
    upstream.on('error', error => {
      if (res.headersSent) return res.destroy(error);
      return res.status(503).json({ error: '本地视频暂时无法读取' });
    });
    upstream.end();
  });

  return router;
}

module.exports = { createLocalExecutorShuihuoRouter, bridgeJSONRequest, signBridgeRequest };
