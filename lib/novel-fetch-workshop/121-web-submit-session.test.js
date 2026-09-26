const assert = require('node:assert/strict');
const test = require('node:test');
const { create121WebSubmitService } = require('./121-web-submit-service');

function makeService({ reference, browserClient, credential = null } = {}) {
  let savedReference = reference;
  return create121WebSubmitService({
    accountResolver: owner => ({ username: owner }),
    createStore: () => ({ getConfig: async () => ({}), saveConfig: async () => {}, listTasks: async () => [] }),
    browserClient,
    sessionStore: {
      getBrowserSession: () => savedReference,
      setBrowserSession: (_owner, next) => { savedReference = next; return next; }
    },
    credentialStore: { get: () => credential, set: () => {} },
    baseUrl: 'http://two.121w.com/tttadmin'
  });
}

test('ensureSession reuses a recently validated account session without rechecking 121', async () => {
  let tests = 0;
  const service = makeService({
    reference: { sessionKey: 'ready-session', targetUsername: 'shared-121', status: 'ready', validatedAt: new Date().toISOString() },
    browserClient: {
      test: async () => { tests += 1; return { ok: true, sessionKey: 'ready-session' }; },
      login: async () => { throw new Error('should not login'); }
    }
  });

  const ready = await service.ensureSession('owner');

  assert.equal(ready.request.sessionKey, 'ready-session');
  assert.equal(tests, 0);
});

test('ensureSession coalesces concurrent expired-session recovery for the same account', async () => {
  let tests = 0;
  let logins = 0;
  const service = makeService({
    reference: { sessionKey: 'expired-session', targetUsername: 'shared-121', status: 'ready', validatedAt: '2020-01-01T00:00:00.000Z' },
    credential: { targetUsername: 'shared-121', password: 'test-only' },
    browserClient: {
      test: async ({ sessionKey }) => {
        tests += 1;
        if (sessionKey === 'expired-session') {
          const error = new Error('expired');
          error.code = 'session_expired';
          throw error;
        }
        return { ok: true, sessionKey };
      },
      login: async () => {
        logins += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ok: true, sessionKey: 'restored-session' };
      }
    }
  });

  const sessions = await Promise.all([
    service.ensureSession('owner'),
    service.ensureSession('owner'),
    service.ensureSession('owner')
  ]);

  assert.equal(logins, 1);
  assert.equal(tests, 2);
  assert.deepEqual(sessions.map(item => item.request.sessionKey), ['restored-session', 'restored-session', 'restored-session']);
});
