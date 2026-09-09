const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { create121WebSubmitService } = require('../lib/novel-fetch-workshop/121-web-submit-service');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

function auth(req, _res, next) {
  req.username = 'alice';
  req.auth = { account: { username: 'alice' } };
  next();
}

function serviceFixture() {
  const sessionStore = {
    browser: { sessionKey: 'opaque', targetUsername: 'site-user', baseUrl: 'http://example.invalid/tttadmin', status: 'ready' },
    getBrowserSession() { return this.browser; },
    setBrowserSession(_owner, value) { this.browser = value; return value; }
  };
  const browserClient = {
    configured: true,
    async test() { return { ok: true, status: 'ready', sessionKey: 'opaque-next' }; },
    async refresh() { throw new Error('refresh not expected'); },
    async login() { throw new Error('login not expected'); },
    async action() { throw new Error('action not expected'); }
  };
  const store = {
    async getConfig() { return { web_submit: { enabled: true, username: 'site-user', password_masked: true } }; },
    async saveConfig() {},
    async listTasks() { return []; }
  };
  return create121WebSubmitService({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    sessionStore,
    credentialStore: { get() { return null; }, set() {} },
    browserClient,
    baseUrl: 'http://example.invalid/tttadmin'
  });
}

async function withServer({ sourceHook, tasks, configStore, parse }, run) {
  const core = express();
  core.locals.novelFetchSourceFetchOriginal = sourceHook;
  core.use(express.json());
  core.use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter({
    auth,
    tasks,
    configStore,
    parse: parse || { parseBooks: () => ({ tasks: [], parsed: 0, emptyIdCount: 0, uniqueTasks: 0, duplicateCount: 0 }) },
    classifier: { classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows, errors: [] }) },
    rewrite: { generateAiVersions: async () => ({ generated: [] }) }
  }));
  const shell = express();
  shell.use(core);
  const server = await new Promise(resolve => {
    const instance = shell.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function configStore(overrides = {}) {
  const config = {
    workflow: { auto_fetch_original: false, auto_rewrite_after_fetch: false, auto_classify_missing: false },
    fetch: { concurrency: 1, default_max_txt: 4000 },
    rewrite: { default_ai_count: 1 },
    ...overrides
  };
  return {
    getConfig: () => config,
    getPlatforms: () => [{ id: '2', name: '平台2' }],
    getStyles: () => [],
    getAiConfig: () => ({})
  };
}

test('121 service exposes existing ensureSession for v2-compose without adding a public credential payload', async () => {
  const service = serviceFixture();
  assert.equal(typeof service.ensureSession, 'function');
  await service.ensureSession('alice');
  assert.equal(Object.hasOwn(service, 'password'), false);
  assert.equal(Object.hasOwn(service, 'credentials'), false);
});

test('server publishes the exact sourceFetchOriginal instance to coreApp.locals before mounting legacy routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /coreApp\.locals\.novelFetchSourceFetchOriginal\s*=\s*sourceFetchOriginal/);
});

test('legacy /process, /tasks/batch-retry and /tasks/:bookId/fetch all reuse the shared source hook', async () => {
  const hookCalls = [];
  const legacyCalls = [];
  const docs = new Map([['10001', { meta: { bookId: '10001', maxTxt: 4000, originalStatus: 'done' } }]]);
  const tasks = {
    async getConfig() { return configStore().getConfig(); },
    async saveTasks(_owner, rows) { for (const row of rows) docs.set(String(row.bookId), { meta: { ...row } }); },
    async listTasks() { return [...docs.values()].map(x => x.meta); },
    async getTask(_owner, id) { return docs.get(String(id)) || null; },
    async fetchOriginal(owner, id, maxTxt) { legacyCalls.push([owner, String(id), Number(maxTxt)]); return { status: 'done' }; },
    async batchRetry(owner, ids, handlers) {
      for (const id of ids) await handlers.fetchOriginal(owner, id, 4000);
      return { requested: ids.length, retried: ids.length };
    }
  };
  const sourceHook = async (owner, request) => {
    hookCalls.push([owner, String(request.bookId), Number(request.maxTxt), typeof request.fallbackFetchOriginal]);
    return { status: 'done' };
  };
  const cfg = configStore({ workflow: { auto_fetch_original: true, auto_rewrite_after_fetch: false, auto_classify_missing: false } });
  const parse = { parseBooks: () => ({ tasks: [{ bookId: '10001' }], parsed: 1, emptyIdCount: 0, uniqueTasks: 1, duplicateCount: 0 }) };

  await withServer({ sourceHook, tasks, configStore: cfg, parse }, async base => {
    let response = await fetch(`${base}/api/novel-fetch-workshop/process`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputText: '10001' })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/novel-fetch-workshop/tasks/batch-retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['10001'] })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/novel-fetch-workshop/tasks/10001/fetch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxTxt: 4000 })
    });
    assert.equal(response.status, 200);
  });

  assert.deepEqual(hookCalls.map(call => call.slice(1, 3)), [
    ['10001', 4000],
    ['10001', 4000],
    ['10001', 4000]
  ]);
  assert.ok(hookCalls.every(call => call[0] === 'alice' && call[3] === 'function'));
  assert.equal(legacyCalls.length, 0);
});

test('legacy fetch route preserves the original tasks.fetchOriginal fallback when no shared source hook exists', async () => {
  const legacyCalls = [];
  const tasks = {
    async getConfig() { return configStore().getConfig(); },
    async getTask() { return { meta: { bookId: '10001', maxTxt: 4000 } }; },
    async listTasks() { return []; },
    async fetchOriginal(owner, id, maxTxt) { legacyCalls.push([owner, String(id), Number(maxTxt)]); return { status: 'done' }; }
  };
  await withServer({ sourceHook: undefined, tasks, configStore: configStore() }, async base => {
    const response = await fetch(`${base}/api/novel-fetch-workshop/tasks/10001/fetch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxTxt: 4000 })
    });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(legacyCalls, [['alice', '10001', 4000]]);
});
