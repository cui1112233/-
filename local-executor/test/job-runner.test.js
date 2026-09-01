const test = require('node:test');
const assert = require('node:assert/strict');
const { JobRunner } = require('../src/job-runner');
const { AccountPool } = require('../src/account-pool');
const { ApiError } = require('../src/api-client');

function claim(id = 'j1') {
  return { job: { id, payload: {}, state: 'leased' }, leaseToken: 'lease', leaseGeneration: 1 };
}

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async progress(token, id, lease, state) { calls.push(['progress', state]); },
    async acceptance(token, id, lease, input) { calls.push(['acceptance', input]); },
    async release(token, id, lease, reason) { calls.push(['release', reason]); },
    async fail(token, id, lease, input) { calls.push(['fail', input]); },
    async result(token, id, lease, artifactId) { calls.push(['result', artifactId]); },
    async renew() { calls.push(['renew']); },
    ...overrides
  };
}

function baseAdapter(script = {}) {
  const calls = [];
  let submitIndex = 0;
  let completionIndex = 0;
  let artifactIndex = 0;
  return {
    calls,
    async prepare() { calls.push('prepare'); },
    async submit() {
      calls.push('submit');
      return (script.submit || [{ status: 'accepted', submissionId: 'msg-1' }])[submitIndex++] || { status: 'not_accepted' };
    },
    async recoverAcceptance() { calls.push('recoverAcceptance'); return script.recover || { status: 'accepted', submissionId: 'msg-1' }; },
    async waitForCompletion() {
      calls.push('waitForCompletion');
      const values = script.completion || [{ mediaId: 'media-1' }];
      const value = values[Math.min(completionIndex++, values.length - 1)];
      if (value instanceof Error) throw value;
      return value;
    },
    async fetchArtifact() {
      calls.push('fetchArtifact');
      const values = script.artifact || [{ artifactId: 'artifact-1' }];
      const value = values[Math.min(artifactIndex++, values.length - 1)];
      if (value instanceof Error) throw value;
      return value;
    }
  };
}

function runner(api, adapter) {
  return new JobRunner({ api, token: 'device', accountPool: new AccountPool([{ id: 'a1', state: 'available' }]), adapter, leaseRenewIntervalMs: 0, retryDelayMs: 0 });
}

test('normal success submits once and returns the artifact', async () => {
  const api = fakeApi();
  const adapter = baseAdapter();
  await runner(api, adapter).runClaim(claim());
  assert.equal(adapter.calls.filter(x => x === 'submit').length, 1);
  assert.equal(api.calls.filter(x => x[0] === 'acceptance').length, 1);
  assert.deepEqual(api.calls.at(-1), ['result', 'artifact-1']);
});

test('unknown submission recovers acceptance on same account without resubmit', async () => {
  const api = fakeApi();
  const adapter = baseAdapter({ submit: [{ status: 'unknown' }], recover: { status: 'accepted', submissionId: 'msg-recovered' } });
  await runner(api, adapter).runClaim(claim());
  assert.equal(adapter.calls.filter(x => x === 'submit').length, 1);
  assert.equal(adapter.calls.filter(x => x === 'recoverAcceptance').length, 1);
});

test('accepted completion connection failure retries completion but never submit', async () => {
  const api = fakeApi();
  const adapter = baseAdapter({ completion: [new Error('webview disconnected'), { mediaId: 'm1' }] });
  await runner(api, adapter).runClaim(claim());
  assert.equal(adapter.calls.filter(x => x === 'submit').length, 1);
  assert.equal(adapter.calls.filter(x => x === 'waitForCompletion').length, 2);
});

test('server cancellation conflict stops before any later submit', async () => {
  let progressCount = 0;
  const api = fakeApi({
    async progress(token, id, lease, state) {
      this.calls.push(['progress', state]);
      progressCount++;
      if (progressCount === 1) throw new ApiError(409, 'local executor job cancelled');
    }
  });
  const adapter = baseAdapter();
  await assert.rejects(() => runner(api, adapter).runClaim(claim()), /cancelled/);
  assert.equal(adapter.calls.filter(x => x === 'submit').length, 0);
});

test('download retry never regenerates', async () => {
  const api = fakeApi();
  const adapter = baseAdapter({ artifact: [new Error('download timeout'), { artifactId: 'artifact-2' }] });
  await runner(api, adapter).runClaim(claim());
  assert.equal(adapter.calls.filter(x => x === 'submit').length, 1);
  assert.equal(adapter.calls.filter(x => x === 'fetchArtifact').length, 2);
  assert.deepEqual(api.calls.at(-1), ['result', 'artifact-2']);
});
