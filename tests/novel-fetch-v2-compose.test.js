const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { attachV78NovelFetchV2 } = require('../lib/novel-fetch-workshop/v2-compose');

test('composition reuses core auth, mounts V2 API, batch store, Browser Worker web-submit, task ops, and starts scheduler runtime', async () => {
  const uses = [];
  const shellApp = { locals: {}, use(...args) { uses.push(args); return this; } };
  const accounts = new Map([['alice', { username: 'alice' }]]);
  const novelFetchStore = { getBrowserSession() {}, setBrowserSession() {} };
  const coreApp = {
    locals: {
      authRuntime: {
        accountStore: {
          files: { audit: path.join('/srv/qiantie/data/system', 'audit.json') },
          getAccount(username) { return accounts.get(username) || null; }
        }
      },
      memberStore: { id: 'members' },
      errorLogStore: { record() {} },
      novelFetchStore
    }
  };
  let executorOptions;
  let runtimeOptions;
  let started = 0;
  let tombstoneOptions;
  let taskOpsOptions;
  let batchOptions;
  let webSubmitOptions;
  let credentialOptions;
  let executed = 0;
  let executorContext = null;
  const batchCalls = [];
  const tombstones = { id: 'tombstones' };
  const taskOps = { processConflicts(owner, payload) { return payload?.input_text === 'blocked' ? ['book-a'] : []; } };
  const batches = {
    current() { return null; }, list() { return []; }, prepareRerun() { return null; },
    complete(owner, id, result) { batchCalls.push(['complete', owner, id, result]); return { id, status: 'done' }; }
  };
  const runtime = { queue: { q: true }, scheduler: { s: true }, startScheduler() { started += 1; } };
  const bodyParser = () => {};
  const router = { router: true };
  const browserClient = { configured: true };
  const credentialStore = { get() {}, set() {} };
  const webSubmitCalls = [];
  const webSubmit = {
    id: 'web-submit',
    async ensureSession(owner) { webSubmitCalls.push(['session', owner]); return { result: { ok: true } }; },
    async syncStyles(owner) { webSubmitCalls.push(['styles', owner]); return { ok: true }; },
    async submit(owner, request) { webSubmitCalls.push(['submit', owner, request]); return { ok: true }; }
  };

  const result = attachV78NovelFetchV2({
    shellApp,
    coreApp,
    bodyParser,
    createBatchExecutor(options) {
      executorOptions = options;
      return async (_owner, _payload, execution) => { executed += 1; executorContext = execution; return { ok: true, tasks: [] }; };
    },
    createTombstones(options) { tombstoneOptions = options; return tombstones; },
    createTaskOps(options) { taskOpsOptions = options; return taskOps; },
    createBatches(options) { batchOptions = options; return batches; },
    createRuntime(options) { runtimeOptions = options; return runtime; },
    createBrowserClient() { return browserClient; },
    createCredentialStore(options) { credentialOptions = options; return credentialStore; },
    createWebSubmit(options) { webSubmitOptions = options; return webSubmit; },
    createRouter(options) {
      assert.equal(options.queue, runtime.queue);
      assert.equal(options.scheduler, runtime.scheduler);
      assert.equal(options.taskOps, taskOps);
      assert.equal(options.batches, batches);
      assert.equal(options.webSubmit, webSubmit);
      return router;
    }
  });

  assert.equal(result, runtime);
  assert.equal(shellApp.locals.authRuntime, coreApp.locals.authRuntime);
  assert.equal(shellApp.locals.memberStore, coreApp.locals.memberStore);
  assert.equal(shellApp.locals.novelFetchV2Runtime, runtime);
  assert.equal(executorOptions.accountResolver('alice').username, 'alice');
  assert.equal(executorOptions.accountResolver('ghost'), null);
  assert.equal(typeof executorOptions.webSessionReady, 'function');
  assert.equal(typeof executorOptions.syncSiteStyles, 'function');
  assert.equal(typeof executorOptions.submit, 'function');
  assert.equal(await executorOptions.webSessionReady('alice'), true);
  await executorOptions.syncSiteStyles('alice');
  await executorOptions.submit('alice', { ids: ['1'] });
  assert.deepEqual(webSubmitCalls, [['session', 'alice'], ['styles', 'alice'], ['submit', 'alice', { ids: ['1'] }]]);
  assert.equal(runtimeOptions.usersDir, path.join('/srv/qiantie/data/system', '..', 'users'));
  assert.equal(typeof runtimeOptions.executeBatch, 'function');
  assert.equal(tombstoneOptions.usersDir, runtimeOptions.usersDir);
  assert.equal(batchOptions.usersDir, runtimeOptions.usersDir);
  assert.equal(taskOpsOptions.tombstones, tombstones);
  assert.equal(taskOpsOptions.accountResolver('alice').username, 'alice');
  assert.equal(shellApp.locals.novelFetchV2TaskOps, taskOps);
  assert.equal(shellApp.locals.novelFetchV2Batches, batches);
  assert.equal(credentialOptions.usersDir, runtimeOptions.usersDir);
  assert.equal(webSubmitOptions.browserClient, browserClient);
  assert.equal(webSubmitOptions.sessionStore, novelFetchStore);
  assert.equal(webSubmitOptions.credentialStore, credentialStore);
  assert.equal(webSubmitOptions.accountResolver('alice').username, 'alice');
  assert.equal(shellApp.locals.novelFetchV2WebSubmit, webSubmit);
  await assert.rejects(() => runtimeOptions.executeBatch('alice', { input_text: 'blocked', batch_id: 'batch-blocked' }), error => { assert.equal(error.status, 410); assert.equal(error.recoverable, false); return true; });
  assert.equal(executed, 0);
  const shouldStop = () => false;
  assert.deepEqual(await runtimeOptions.executeBatch('alice', { input_text: 'ok', batch_id: 'batch-1' }, { shouldStop }), { ok: true, tasks: [] });
  assert.equal(executed, 1);
  assert.equal(executorContext.shouldStop, shouldStop);
  assert.deepEqual(batchCalls, [['complete', 'alice', 'batch-1', { ok: true, tasks: [] }]]);
  assert.equal(started, 1);
  assert.deepEqual(uses, [['/api/batch-rewrite', bodyParser, router]]);
});
