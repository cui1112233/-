const test = require('node:test');
const assert = require('node:assert/strict');

const { create121WebSubmitService } = require('../lib/novel-fetch-workshop/121-web-submit-service');

function createHarness({ loginResult = { ok: true, status: 'ready', sessionKey: 'session-1' }, testResult, testError } = {}) {
  const calls = [];
  const config = { web_submit: {} };
  const store = {
    async getConfig() { return config; },
    async saveConfig(next) { Object.assign(config, next); },
    async listTasks() { return []; }
  };
  const browserSession = new Map();
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
    credentialStore: { get: () => null, set: () => {} }
  });
  return { calls, config, browserSession, service };
}

test('121 login verifies the new session before reporting success and exposes session verification', async () => {
  const { calls, browserSession, service } = createHarness();

  assert.equal(typeof service.ensureSession, 'function');
  await service.saveConfig('owner-1', { username: '121-user', password: 'secret' });

  assert.deepEqual(calls.map(([kind]) => kind), ['login', 'test']);
  assert.equal(browserSession.get('owner-1').targetUsername, '121-user');
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
