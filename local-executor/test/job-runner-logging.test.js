const test = require('node:test');
const assert = require('node:assert/strict');
const { JobRunner } = require('../src/job-runner');
const { AccountPool } = require('../src/account-pool');

function makeRunner(logger) {
  const api = {
    async progress() {},
    async acceptance() {},
    async release() {},
    async fail() {},
    async renew() {},
    async uploadArtifact() { return { artifactId: 'artifact-1' }; },
    async result() {}
  };
  const adapter = {
    async prepare() {},
    async submit() { return { status: 'accepted', submissionId: 'msg-1' }; },
    async recoverAcceptance() { return { status: 'accepted', submissionId: 'msg-1' }; },
    async waitForCompletion() { return { mediaId: 'media-1' }; },
    async fetchArtifact() { return { filePath: '/tmp/video.mp4' }; },
    async dispose() {}
  };
  return new JobRunner({
    api,
    token: 'secret-device-token',
    accountPool: new AccountPool([{ id: 'account-1', state: 'available' }]),
    adapter,
    logger,
    leaseRenewIntervalMs: 0,
    retryDelayMs: 0
  });
}

function claim() {
  return {
    job: { id: 'job-1', payload: {}, state: 'leased' },
    leaseToken: 'secret-lease-token',
    leaseGeneration: 1
  };
}

test('job runner emits high-level boundary events without exposing credentials', async () => {
  const events = [];
  const logger = {
    async event(name, fields) { events.push({ name, fields }); }
  };

  await makeRunner(logger).runClaim(claim());

  assert.deepEqual(events.map(item => item.name), [
    'JOB_CLAIMED',
    'ACCOUNT_ACQUIRED',
    'ACCEPTANCE_DETECTED',
    'GENERATION_STARTED',
    'ARTIFACT_UPLOADED',
    'JOB_COMPLETED'
  ]);
  const raw = JSON.stringify(events);
  assert.equal(raw.includes('secret-device-token'), false);
  assert.equal(raw.includes('secret-lease-token'), false);
});

test('logging failure never breaks a video job', async () => {
  const logger = { async event() { throw new Error('disk full'); } };
  const result = await makeRunner(logger).runClaim(claim());
  assert.deepEqual(result, { succeeded: true, artifactId: 'artifact-1' });
});
