const path = require('node:path');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function attachV78NovelFetchV2({
  shellApp,
  coreApp,
  bodyParser,
  createBatchExecutor,
  createRuntime,
  createRouter,
  createTombstones,
  createTaskOps,
  createBrowserClient,
  createCredentialStore,
  createWebSubmit
} = {}) {
  if (!shellApp || typeof shellApp.use !== 'function') throw new Error('shellApp is required');
  const authRuntime = coreApp?.locals?.authRuntime;
  if (!authRuntime?.accountStore) throw new Error('core auth runtime is required');
  const auditPath = authRuntime.accountStore.files?.audit;
  if (!auditPath) throw new Error('core audit path is required');

  const credentialSecret = requiredEnv('QIANTIE_121_CREDENTIAL_SECRET');
  const bridgeSecret = requiredEnv('QIANTIE_BRIDGE_SECRET');

  const batchExecutorFactory = createBatchExecutor || require('./v2-batch-executor').createV78NovelFetchBatchExecutor;
  const runtimeFactory = createRuntime || require('./v2-runtime').createNovelFetchV2Runtime;
  const routerFactory = createRouter || require('../../routes/batch-rewrite-v2').createBatchRewriteV2Router;
  const tombstoneFactory = createTombstones || require('./tombstones').createNovelFetchTombstones;
  const taskOpsFactory = createTaskOps || require('./task-ops').createNovelFetchTaskOps;
  const browserClientFactory = createBrowserClient || require('./121-browser-client').create121BrowserClient;
  const credentialStoreFactory = createCredentialStore || require('./121-credential-store').create121CredentialStore;
  const webSubmitFactory = createWebSubmit || require('./121-web-submit-service').create121WebSubmitService;
  const parser = bodyParser || require('express').json({ limit: '50mb' });
  const errorLogStore = coreApp.locals?.errorLogStore;

  const accountResolver = username => {
    try { return authRuntime.accountStore.getAccount(username) || null; }
    catch (_) { return null; }
  };
  const usersDir = path.join(path.dirname(auditPath), '..', 'users');
  const browserClient = browserClientFactory();
  const credentialStore = credentialStoreFactory({ usersDir, secret: credentialSecret });
  const sessionStore = coreApp.locals?.novelFetchStore;
  if (!sessionStore?.getBrowserSession || !sessionStore?.setBrowserSession) throw new Error('core novel fetch browser session store is required');
  const createStore = ({ account }) => require('./mysql-store').createMySQLWorkshopStore({
    account,
    bridgeSecret,
    targetBaseUrl: process.env.QIANTIE_GO_BASE_URL
  });
  const webSubmit = webSubmitFactory({ accountResolver, createStore, browserClient, sessionStore, credentialStore });
  const executeBatch = batchExecutorFactory({
    accountResolver,
    webSessionReady: async owner => {
      try { await webSubmit.ensureSession(owner); return true; }
      catch (_) { return false; }
    },
    syncSiteStyles: owner => webSubmit.syncStyles(owner),
    submit: (owner, request) => webSubmit.submit(owner, request)
  });
  const tombstones = tombstoneFactory({ usersDir });
  const taskOpsOptions = { accountResolver, tombstones };
  if (!createTaskOps) {
    taskOpsOptions.createStore = options => require('./mysql-store').createMySQLWorkshopStore({ ...options, bridgeSecret, targetBaseUrl: process.env.QIANTIE_GO_BASE_URL });
    taskOpsOptions.parseBooks = require('./parse').parseBooks;
  }
  const taskOps = taskOpsFactory(taskOpsOptions);
  const guardedExecuteBatch = async (owner, payload) => {
    const conflicts = taskOps.processConflicts(owner, payload || {});
    if (conflicts.length) {
      const error = new Error(`书籍已永久删除：${conflicts.join('、')}`);
      error.status = 410;
      error.code = 'permanently_deleted';
      error.bookIds = conflicts;
      error.recoverable = false;
      throw error;
    }
    return executeBatch(owner, payload);
  };
  const runtime = runtimeFactory({
    usersDir,
    executeBatch: guardedExecuteBatch,
    onSchedulerError(error) {
      if (errorLogStore && typeof errorLogStore.record === 'function') {
        errorLogStore.record({ kind: 'novel-fetch-v2.scheduler', message: error?.message || String(error), status: 500 });
      }
    }
  });

  shellApp.locals.authRuntime = authRuntime;
  if (coreApp.locals?.memberStore) shellApp.locals.memberStore = coreApp.locals.memberStore;
  shellApp.locals.novelFetchV2Runtime = runtime;
  shellApp.locals.novelFetchV2TaskOps = taskOps;
  shellApp.locals.novelFetchV2Tombstones = tombstones;
  shellApp.locals.novelFetchV2WebSubmit = webSubmit;
  shellApp.use('/api/batch-rewrite', parser, routerFactory({ queue: runtime.queue, scheduler: runtime.scheduler, taskOps, webSubmit }));
  runtime.startScheduler();
  return runtime;
}

module.exports = { requiredEnv, attachV78NovelFetchV2 };
