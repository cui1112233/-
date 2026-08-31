const path = require('node:path');

function attachV78NovelFetchV2({
  shellApp,
  coreApp,
  bodyParser,
  createBatchExecutor,
  createRuntime,
  createRouter
} = {}) {
  if (!shellApp || typeof shellApp.use !== 'function') throw new Error('shellApp is required');
  const authRuntime = coreApp?.locals?.authRuntime;
  if (!authRuntime?.accountStore) throw new Error('core auth runtime is required');
  const auditPath = authRuntime.accountStore.files?.audit;
  if (!auditPath) throw new Error('core audit path is required');

  const batchExecutorFactory = createBatchExecutor || require('./v2-batch-executor').createV78NovelFetchBatchExecutor;
  const runtimeFactory = createRuntime || require('./v2-runtime').createNovelFetchV2Runtime;
  const routerFactory = createRouter || require('../../routes/batch-rewrite-v2').createBatchRewriteV2Router;
  const parser = bodyParser || require('express').json({ limit: '50mb' });
  const errorLogStore = coreApp.locals?.errorLogStore;

  const accountResolver = username => {
    try { return authRuntime.accountStore.getAccount(username) || null; }
    catch (_) { return null; }
  };
  const executeBatch = batchExecutorFactory({ accountResolver });
  const usersDir = path.join(path.dirname(auditPath), '..', 'users');
  const runtime = runtimeFactory({
    usersDir,
    executeBatch,
    onSchedulerError(error) {
      if (errorLogStore && typeof errorLogStore.record === 'function') {
        errorLogStore.record({ kind: 'novel-fetch-v2.scheduler', message: error?.message || String(error), status: 500 });
      }
    }
  });

  shellApp.locals.authRuntime = authRuntime;
  if (coreApp.locals?.memberStore) shellApp.locals.memberStore = coreApp.locals.memberStore;
  shellApp.locals.novelFetchV2Runtime = runtime;
  shellApp.use('/api/batch-rewrite', parser, routerFactory({ queue: runtime.queue, scheduler: runtime.scheduler }));
  runtime.startScheduler();
  return runtime;
}

module.exports = { attachV78NovelFetchV2 };
