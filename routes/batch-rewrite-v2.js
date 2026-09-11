const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');
const { createWebSubmitOperationStore } = require('../lib/novel-fetch-workshop/web-submit-operations');

function errorStatus(error) {
  if (error?.code === 'unauthorized' || error?.workerResponse?.error === 'unauthorized' || error?.workerResponse?.code === 'unauthorized') return 503;
  if (error?.code === 'BROWSER_WORKER_UNAUTHORIZED') return 503;
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) return error.status;
  if (['BROWSER_WORKER_UNAVAILABLE', 'BROWSER_WORKER_TIMEOUT'].includes(error?.code)) return 503;
  return 400;
}

function safeErrorMessage(error, fallback = '121 操作失败') {
  const message = String(error?.message || fallback);
  return /password|cookie|session|secret|token|authorization/i.test(message) ? fallback : message;
}

function safeErrorResponse(error) {
  const response = { ok: false, error: safeErrorMessage(error) };
  if (error?.code === 'unauthorized' || error?.workerResponse?.error === 'unauthorized' || error?.workerResponse?.code === 'unauthorized') response.code = 'BROWSER_WORKER_UNAUTHORIZED';
  else if (['BROWSER_WORKER_UNAVAILABLE', 'BROWSER_WORKER_TIMEOUT', 'BROWSER_WORKER_UNAUTHORIZED'].includes(error?.code)) response.code = error.code;
  return response;
}

function registerWebSubmitRoutes(router, webSubmit, { operations = createWebSubmitOperationStore() } = {}) {
  if (!webSubmit) return router;
  const run = handler => async (req, res, next) => {
    try { return await handler(req, res); }
    catch (error) {
      if (res.headersSent) return next(error);
      return res.status(errorStatus(error)).json(safeErrorResponse(error));
    }
  };

  router.get('/web-submit/config', run(async (req, res) => res.json(await webSubmit.getConfig(req.username))));
  router.post('/web-submit/config', run(async (req, res) => res.json(await webSubmit.saveConfig(req.username, req.body?.settings || {}))));
  router.get('/web-submit/environment', run(async (req, res) => res.json(await webSubmit.environment(req.username))));
  router.post('/web-submit/operations', run(async (req, res) => {
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    if (!['login', 'configs', 'styles'].includes(kind)) {
      const error = new Error('不支持的 121 后台操作');
      error.status = 400;
      throw error;
    }
    if (kind === 'login') {
      const username = String(req.body?.username || '').trim();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!username || !password) {
        const error = new Error('请输入 121 用户名和密码');
        error.status = 400;
        throw error;
      }
      return res.status(202).json(operations.create(req.username, kind,
        report => { report('login', '正在登录批量后台'); return webSubmit.saveConfig(req.username, { username, password }); },
        { queued: '已进入登录后台任务', done: '登录批量后台成功' }));
    }
    const action = kind === 'styles' ? 'syncStyles' : 'syncConfigs';
    const label = kind === 'styles' ? '批量风格类型' : '批量后台配置';
    return res.status(202).json(operations.create(req.username, kind, async report => {
      report('session', '正在校验登录会话');
      report('remote', `正在读取${label}`);
      const result = await webSubmit[action](req.username);
      report('saving', `正在保存${label}`);
      return result;
    }, { queued: `已进入${label}后台任务`, done: `${label}同步完成` }));
  }));
  router.get('/web-submit/operations/:id', run(async (req, res) => {
    const operation = operations.get(req.username, req.params?.id);
    if (!operation) return res.status(404).json({ ok: false, error: '后台操作不存在' });
    return res.json(operation);
  }));
  router.post('/web-submit/sync-configs', run(async (req, res) => res.json(await webSubmit.syncConfigs(req.username))));
  router.post('/web-submit/sync-styles', run(async (req, res) => res.json(await webSubmit.syncStyles(req.username))));
  router.post('/web-submit/test-visible', run(async (req, res) => res.json(await webSubmit.testVisible(req.username))));
  router.post('/web-submit/preview', run(async (req, res) => res.json(await webSubmit.preview(req.username, req.body || {}))));
  router.post('/web-submit/submit', run(async (req, res) => res.json(await webSubmit.submit(req.username, req.body || {}))));
  return router;
}

function createBatchRewriteV2Router({ queue, scheduler, taskOps, batches, webSubmit, auth, routerFactory } = {}) {
  const createRouter = routerFactory || (() => require('express').Router());
  const router = createRouter();
  const authMiddleware = auth || require('../middleware/auth').apiAuth;
  router.use(authMiddleware);
  registerWebSubmitRoutes(router, webSubmit, { operations: createWebSubmitOperationStore() });
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps, batches });
  return router;
}

module.exports = { errorStatus, registerWebSubmitRoutes, createBatchRewriteV2Router };
