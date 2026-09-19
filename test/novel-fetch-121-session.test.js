const test = require('node:test');
const assert = require('node:assert/strict');

const { create121WebSubmitService } = require('../lib/novel-fetch-workshop/121-web-submit-service');

function createHarness({ loginResult = { ok: true, status: 'ready', sessionKey: 'session-1' }, testResult, testError, savedCredentials = null, initialSession = null } = {}) {
  const calls = [];
  const config = { web_submit: {} };
  const store = {
    async getConfig() { return config; },
    async saveConfig(next) { Object.assign(config, next); },
    async listTasks() { return []; }
  };
  const browserSession = new Map(initialSession ? [['owner-1', initialSession]] : []);
  const credentialWrites = [];
  const browserClient = {
    configured: true,
    async login(input) { calls.push(['login', input]); return loginResult; },
    async test(input) {
      calls.push(['test', input]);
      if (testError) throw testError;
      return testResult || { ok: true, status: 'ready', sessionKey: input.sessionKey };
    }
  };
  const service = create121WebSubmitService({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    browserClient,
    sessionStore: {
      getBrowserSession: owner => browserSession.get(owner) || null,
      setBrowserSession: (owner, value) => { browserSession.set(owner, value); return value; }
    },
    credentialStore: { get: () => savedCredentials, set: (owner, value) => { credentialWrites.push([owner, value]); return { saved: true }; } }
  });
  return { calls, config, browserSession, credentialWrites, service };
}

test('121 login verifies the new session before reporting success and exposes session verification', async () => {
  const { calls, browserSession, credentialWrites, service } = createHarness();

  assert.equal(typeof service.ensureSession, 'function');
  await service.saveConfig('owner-1', { username: '121-user', password: 'secret' });

  assert.deepEqual(calls.map(([kind]) => kind), ['login', 'test']);
  assert.equal(browserSession.get('owner-1').targetUsername, '121-user');
  assert.deepEqual(credentialWrites, [['owner-1', { targetUsername: '121-user', password: 'secret', baseUrl: 'http://two.121w.com/tttadmin' }]]);
});

test('121 login does not persist a success when immediate session verification fails', async () => {
  const error = Object.assign(new Error('target session expired'), { status: 401, code: 'TARGET_SESSION_EXPIRED' });
  const { browserSession, service } = createHarness({ testError: error });

  await assert.rejects(
    service.saveConfig('owner-1', { username: '121-user', password: 'secret' }),
    /121 登录会话已失效/
  );
  assert.equal(browserSession.has('owner-1'), false);
});

test('121 会话缺失时使用已加密保存的凭据直连恢复并再次验证', async () => {
  const { calls, browserSession, service } = createHarness({
    savedCredentials: { targetUsername: '121-user', password: 'secret', baseUrl: 'http://two.121w.com/tttadmin' }
  });

  const result = await service.ensureSession('owner-1');

  assert.equal(result.result.ok, true);
  assert.deepEqual(calls.map(([kind]) => kind), ['login', 'test']);
  assert.equal(browserSession.get('owner-1').targetUsername, '121-user');
});

test('121 会话过期时自动重新登录，不把旧会话错误暴露给同步流程', async () => {
  let testCount = 0;
  const expired = Object.assign(new Error('target session expired'), { status: 401, code: 'TARGET_SESSION_EXPIRED' });
  const harness = createHarness({
    savedCredentials: { targetUsername: '121-user', password: 'secret', baseUrl: 'http://two.121w.com/tttadmin' },
    initialSession: { targetUsername: '121-user', sessionKey: 'old-session', status: 'ready' }
  });
  const originalTest = harness.service.ensureSession;
  assert.equal(typeof originalTest, 'function');
  // The injected browser client is intentionally replaced through a second service
  // harness so the first validation fails and the restored session succeeds.
  const { create121WebSubmitService } = require('../lib/novel-fetch-workshop/121-web-submit-service');
  const store = {
    async getConfig() { return { web_submit: { username: '121-user' } }; },
    async saveConfig() {},
    async listTasks() { return []; }
  };
  const browserSession = new Map([['owner-1', { targetUsername: '121-user', sessionKey: 'old-session', status: 'ready' }]]);
  const browserClient = {
    configured: true,
    async login(input) { calls.push(['login', input]); return { ok: true, status: 'ready', sessionKey: 'new-session' }; },
    async test(input) { testCount += 1; calls.push(['test', input]); if (testCount === 1) throw expired; return { ok: true, status: 'ready', sessionKey: input.sessionKey }; }
  };
  const calls = [];
  const service = create121WebSubmitService({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    browserClient,
    sessionStore: { getBrowserSession: owner => browserSession.get(owner) || null, setBrowserSession: (owner, value) => { browserSession.set(owner, value); return value; } },
    credentialStore: { get: () => ({ targetUsername: '121-user', password: 'secret', baseUrl: 'http://two.121w.com/tttadmin' }), set: () => ({ saved: true }) }
  });

  await service.ensureSession('owner-1');
  assert.deepEqual(calls.map(([kind]) => kind), ['test', 'login', 'test']);
  assert.equal(browserSession.get('owner-1').sessionKey, 'new-session');
});
