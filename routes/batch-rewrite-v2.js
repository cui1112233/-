const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');

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

function registerWebSubmitRoutes(router, webSubmit) {
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
  registerWebSubmitRoutes(router, webSubmit);
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps, batches });
  return router;
}

module.exports = { errorStatus, registerWebSubmitRoutes, createBatchRewriteV2Router };
