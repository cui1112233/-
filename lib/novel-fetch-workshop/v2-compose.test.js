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
      novelFetchStore: { getSession() {}, setSession() {} }
    }
  };

  attachV78NovelFetchV2({
    shellApp,
    coreApp,
    bodyParser: {},
    createDirectClient: () => directClient,
    createCredentialStore: () => ({}),
    createWebSubmit: options => {
      receivedDirectClient = options.directClient;
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
});
