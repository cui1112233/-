const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createV78NovelFetchBatchExecutor } = require('../lib/novel-fetch-workshop/v2-batch-executor');
const { attachV78NovelFetchV2 } = require('../lib/novel-fetch-workshop/v2-compose');

test('batch executor forwards sourceFetchOriginal into runner with owner-scoped tasks', async () => {
  const tasks = { getConfig: async () => ({}) };
  let runnerOptions;
  let sourceCall;
  const execute = createV78NovelFetchBatchExecutor({
    accountResolver: owner => ({ username: owner }),
    createStore: () => tasks,
    runBatch: async options => { runnerOptions = options; return { fetched: 0 }; },
    parseBooks: () => ({ tasks: [] }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows, errors: [] }),
    applyRules: async () => {},
    generateAiVersions: async () => ({ generated: [] }),
    sourceFetchOriginal: async (owner, request) => { sourceCall = { owner, request }; return { status: 'done' }; }
  });
  await execute('alice', { input_text: 'A' });
  assert.equal(typeof runnerOptions.sourceFetchOriginal, 'function');
  await runnerOptions.sourceFetchOriginal({ task: { bookId: '10001', maxTxt: 4000 } });
  assert.equal(sourceCall.owner, 'alice');
  assert.equal(sourceCall.request.tasks, tasks);
  assert.equal(sourceCall.request.task.bookId, '10001');
});

test('composition passes sourceFetchOriginal into the batch executor without exposing session credentials', () => {
  const shellApp = { locals: {}, use() { return this; } };
  const coreApp = { locals: {
    authRuntime: { accountStore: { files: { audit: '/srv/data/system/audit.json' }, getAccount: username => ({ username }) } },
    novelFetchStore: { getBrowserSession() {}, setBrowserSession() {} }
  } };
  let executorOptions;
  const injected = async () => ({ status: 'done' });
  attachV78NovelFetchV2({
    shellApp,
    coreApp,
    bodyParser: () => {},
    sourceFetchOriginal: injected,
    createBatchExecutor(options) { executorOptions = options; return async () => ({}); },
    createRuntime: () => ({ queue: {}, scheduler: {}, startScheduler() {} }),
    createRouter: () => ({}),
    createTombstones: () => ({}),
    createTaskOps: () => ({ processConflicts: () => [] }),
    createBatches: () => ({ complete() {} }),
    createBrowserClient: () => ({}),
    createCredentialStore: () => ({}),
    createWebSubmit: () => ({ ensureSession: async () => ({}), syncStyles: async () => ({}), submit: async () => ({}) })
  });
  assert.equal(executorOptions.sourceFetchOriginal, injected);
});

test('server constructs and attaches sourceFetchOriginal before the V2 runtime is mounted', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /createSourceFetchOriginal/);
  assert.match(source, /sourceFetchOriginal/);
  const createAt = source.indexOf('createSourceFetchOriginal');
  const attachAt = source.indexOf('attachV78NovelFetchV2({');
  assert.ok(createAt >= 0 && attachAt > createAt);
  const attachBlock = source.slice(attachAt, source.indexOf(');', attachAt) + 2);
  assert.match(attachBlock, /sourceFetchOriginal/);
});
