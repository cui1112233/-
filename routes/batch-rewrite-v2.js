const { registerNovelFetchV2Routes } = require('../lib/novel-fetch-workshop/v2-api-contract');

function createBatchRewriteV2Router({ queue, scheduler, taskOps, auth, routerFactory } = {}) {
  const createRouter = routerFactory || (() => require('express').Router());
  const router = createRouter();
  const authMiddleware = auth || require('../middleware/auth').apiAuth;
  router.use(authMiddleware);
  registerNovelFetchV2Routes(router, { queue, scheduler, taskOps });
  return router;
}

module.exports = { createBatchRewriteV2Router };
