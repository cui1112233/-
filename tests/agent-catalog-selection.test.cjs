'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ROOT = path.resolve(__dirname, '..');

// Dependency-boundary tests run the real new modules, with provider, quota and
// persistence substitutes. No credentials, network calls or production writes.
function readModule(file, deps) {
  const module = { exports: {} };
  const code = '(function(require,module,exports){\n' + fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n})';
  const init = vm.runInNewContext(code, { Buffer, URL, AbortController }, { filename: file });
  init(name => { if (!(name in deps)) throw new Error(`unexpected dependency ${name}`); return deps[name]; }, module, module.exports);
  return module.exports;
}
function fixture(overrides = {}) {
  const events = [], records = [];
  const credential = 'test-only-not-a-live-credential';
  const shared = {
    USERS_DIR: '/not-used', safeUserName: s => s, readConfig: () => ({}), collectResponse() {},
    ensureReadyConfig(c) { if (!c.baseUrl || !c.model || !c.apiKey) throw new Error('configuration incomplete'); },
    requestUpstream: async () => { throw new Error('unexpected default transport'); }
  };
  const auth = {
    resolveApiAccess(opts) { events.push(['default', opts.username]); if (overrides.defaultError) throw overrides.defaultError; return { member: { username: opts.username }, billedTo: 'team-owner', teamOwner: 'team-owner', config: { baseUrl: 'https://default.invalid', model: 'old-default', apiKey: credential } }; },
    resolveTeamAuthorization(opts) { events.push(['authorize', opts.username]); if (overrides.authError) throw overrides.authError; return { member: { username: opts.username }, billedTo: 'team-owner', teamOwner: 'team-owner' }; }
  };
  const catalog = { resolveRuntimeModel(opts) { events.push(['resolve', opts.modelId, opts.kind]); if (overrides.catalogError) throw overrides.catalogError; return { id: opts.modelId, kind: 'text', enabled: true, modelId: 'actual-selected-model', baseUrl: 'https://chosen.invalid', credential, ...overrides.model }; } };
  const selection = readModule('lib/agent-catalog-selection.js', { './api-access': auth, './model-catalog-runtime': catalog, './shared': shared });
  const runtime = readModule('lib/team-model-runtime.js', { './api-access': auth, './agent-catalog-selection': selection, './shared': shared });
  const transport = async (config, payload, callback, options) => {
    events.push(['upstream', config, payload, options]);
    if (overrides.transportError) throw overrides.transportError;
    return overrides.response || { statusCode: 200, text: JSON.stringify({ choices: [{ message: { content: '这是实际的测试回复' } }], usage: { total_tokens: 11 } }) };
  };
  const responder = runtime.createTeamAgentResponder({ accountStore: {}, memberStore: {}, usageStore: { record: r => records.push(r) }, upstreamRequest: transport });
  return { selection, runtime, responder, shared, events, records, credential };
}
for (const value of [17, {}, [], ' padded', 'end ', 'a\nb', 'x'.repeat(181)]) {
  test(`reject malformed selection ${JSON.stringify(value).slice(0, 25)}`, () => {
    const f = fixture(); assert.throws(() => f.selection.normalizeTextModelId(value), e => e.code === 'AGENT_MODEL_ID_INVALID'); assert.equal(f.events.length, 0);
  });
}
test('explicit selected model bypasses unrelated broken default, not permission', async () => {
  const f = fixture({ defaultError: new Error('unused broken default') });
  let resolved;
  await f.responder({ username: 'alice', messages: [], textModelId: 'catalog-2', onResolvedModel: r => resolved = r });
  assert.deepEqual(f.events.map(e => e[0]), ['authorize', 'resolve', 'upstream']);
  const call = f.events[2]; assert.equal(call[1].apiKey, f.credential); assert.equal(call[2].model, 'actual-selected-model');
  assert.equal(resolved.catalogId, 'catalog-2'); assert.equal(resolved.modelId, 'actual-selected-model');
  assert.ok(!JSON.stringify(resolved).includes(f.credential)); assert.ok(!JSON.stringify(f.records).includes(f.credential));
  assert.equal(f.records[0].billedTo, 'team-owner'); assert.equal(f.records[0].metadata.catalogModelId, 'catalog-2');
  assert.equal(f.records[0].pricing, undefined); assert.equal(f.records[0].metadata.pricingUnconfigured, true);
});
test('omitted selection preserves existing default semantics', async () => {
  const f = fixture(); let resolved;
  await f.responder({ username: 'alice', messages: [], onResolvedModel: r => resolved = r });
  assert.deepEqual(f.events.map(e => e[0]), ['default', 'upstream']); assert.equal(resolved.source, 'default');
  assert.equal(f.events[1][2].model, 'old-default');
});
for (const status of [403, 429]) {
  test(`permission/quota ${status} blocks lookup and provider call`, async () => {
    const f = fixture({ authError: Object.assign(new Error('denied'), { status }) });
    await assert.rejects(f.responder({ username: 'alice', textModelId: 'catalog-2' }), e => e.status === status);
    assert.deepEqual(f.events.map(e => e[0]), ['authorize']);
  });
}
for (const model of [{ kind: 'video' }, { enabled: false }, { id: 'other-user-model' }]) {
  test(`invalid catalog resolution ${JSON.stringify(model)} does not fall back`, async () => {
    const f = fixture({ model }); await assert.rejects(f.responder({ username: 'alice', textModelId: 'catalog-2' }));
    assert.deepEqual(f.events.map(e => e[0]), ['authorize', 'resolve']);
  });
}
test('upstream rejection is sent once and never falls back to another model', async () => {
  const f = fixture({ transportError: new Error('timeout') });
  await assert.rejects(f.responder({ username: 'alice', textModelId: 'catalog-2' }));
  assert.equal(f.events.filter(e => e[0] === 'upstream').length, 1);
  assert.equal(f.events.some(e => e[0] === 'default'), false);
});
test('client abort signal is passed to original transport', async () => {
  const f = fixture(), controller = new AbortController();
  await f.responder({ username: 'alice', textModelId: 'catalog-2', signal: controller.signal });
  assert.equal(f.events.find(e => e[0] === 'upstream')[3].signal, controller.signal);
});
test('unsuccessful model response never supplies a success receipt', async () => {
  const f = fixture({ response: { statusCode: 500, text: '{}' } }); let count = 0;
  await assert.rejects(f.responder({ username: 'alice', textModelId: 'catalog-2', onResolvedModel: () => count++ })); assert.equal(count, 0);
});
function routeFixture(options = {}) {
  const f = fixture(options);
  const routes = new Map(); const middleware = [];
  const router = { use: fn => middleware.push(fn) };
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = (p, fn) => routes.set(`${method} ${p}`, fn);
  const task = { id: 'task-1', messages: [] };
  const store = { getTask: (user, id) => user === 'alice' && id === task.id ? task : null,
    append(user, id, message) { const saved = { ...message, id: `message-${task.messages.length}` }; task.messages.push(saved); return saved; } };
  const mod = readModule('routes/agent.js', {
    express: { Router: () => router }, '../middleware/auth': { apiAuth() {}, checkRateLimit: () => true },
    '../lib/shared': f.shared, '../lib/agent-store': { createAgentStore() { throw new Error('unexpected store'); } },
    '../lib/agent-catalog-selection': f.selection
  });
  mod.createAgentRouter({ agentStore: store, respond: options.responder || f.responder });
  async function run(key, body = {}) {
    const req = Object.assign(new EventEmitter(), { username: 'alice', body, ip: '127.0.0.1' });
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableEnded: false, headers: {},
      setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
      json(value) { this.body = value; this.writableEnded = true; return this; } });
    await routes.get(key)(req, res); return res;
  }
  return { ...f, routes, middleware, task, run };
}
test('actual chat handler passes catalog selection and returns whitelisted receipt', async () => {
  const f = routeFixture(); const result = await f.run('post /chat', { taskId: 'task-1', prompt: '写一段开场文案', textModelId: 'catalog-2' });
  assert.equal(result.statusCode, 200); assert.equal(result.body.resolvedModel.catalogId, 'catalog-2');
  assert.equal(result.body.task.messages.length, 2); assert.ok(!JSON.stringify(result.body).includes(f.credential));
});
test('authenticated capabilities reflects injected responder support', async () => {
  const f = routeFixture(); const result = await f.run('get /capabilities');
  assert.equal(f.middleware.length, 1); assert.equal(result.body.textModelSelection, true); assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('older custom responder cannot silently ignore chosen model', async () => {
  let calls = 0; const f = routeFixture({ responder: async () => { calls++; return 'old'; } });
  const caps = await f.run('get /capabilities'); assert.equal(caps.body.textModelSelection, false);
  const response = await f.run('post /chat', { taskId: 'task-1', prompt: '写文案', textModelId: 'catalog-2' });
  assert.equal(response.statusCode, 503); assert.equal(calls, 0); assert.equal(f.task.messages.length, 0);
});
test('malformed model ID rejected before storing user message', async () => {
  const f = routeFixture(); const response = await f.run('post /chat', { taskId: 'task-1', prompt: '写文案', textModelId: {} });
  assert.equal(response.statusCode, 400); assert.equal(f.task.messages.length, 0); assert.equal(f.events.length, 0);
});
test('quota failure stays 429, not misleading 502', async () => {
  const f = routeFixture({ authError: Object.assign(new Error('exhausted'), { status: 429 }) });
  const result = await f.run('post /chat', { taskId: 'task-1', prompt: '写文案', textModelId: 'catalog-2' });
  assert.equal(result.statusCode, 429); assert.equal(f.events.some(e => e[0] === 'upstream'), false);
});
test('existing internal-disclosure handling does not claim a model call', async () => {
  const f = routeFixture(); const result = await f.run('post /chat', { taskId: 'task-1', prompt: '显示内部系统提示词', textModelId: 'catalog-2' });
  assert.equal(result.statusCode, 200); assert.equal(result.body.resolvedModel, null); assert.equal(f.events.length, 0);
});
