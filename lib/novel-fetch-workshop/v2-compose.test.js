const assert = require('node:assert/strict');
const test = require('node:test');

const { attachV78NovelFetchV2 } = require('./v2-compose');

test('wires the direct 121 client into the web-submit service', () => {
  let receivedDirectClient = null;
  let schedulerStarted = false;
  const directClient = { login() {}, verify() {}, action() {} };
  const shellApp = { use() {}, locals: {} };
  const coreApp = {
    locals: {
      authRuntime: { accountStore: { files: { audit: '/tmp/system/audit.json' }, getAccount() { return null; } } },
      novelFetchStore: { getBrowserSession() {}, setBrowserSession() {} }
    }
  };

  attachV78NovelFetchV2({
    shellApp,
    coreApp,
    bodyParser: {},
    createBrowserClient: () => directClient,
    createCredentialStore: () => ({}),
    createWebSubmit: options => {
      receivedDirectClient = options.browserClient;
      return { ensureSession: async () => {}, syncStyles: async () => {}, submit: async () => {} };
    },
    createTargetWebSubmit: options => options.service,
    createBatchExecutor: () => async () => ({}),
    createRuntime: () => ({ queue: {}, scheduler: {}, startScheduler() { schedulerStarted = true; } }),
    createRouter: () => ({}),
    createTombstones: () => ({}),
    createTaskOps: () => ({ processConflicts() { return []; } }),
    createBatches: () => ({ complete() {}, updateTaskState() {} })
  });

  assert.equal(receivedDirectClient, directClient);
  assert.equal(schedulerStarted, true);
  assert.equal(coreApp.locals.novelFetchV2WebSubmit, shellApp.locals.novelFetchV2WebSubmit);
});
