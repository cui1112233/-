const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForwardRequest, PUBLIC_ARTIFACT_PATH } = require('../lib/local-executor-device-forwarder');

test('signed artifact GET is forwarded without a browser cookie requirement', () => {
  const request = buildForwardRequest({
    method: 'GET',
    originalUrl: '/api/local-executor/v1/artifacts/artifact_1?token=short-lived',
    headers: {},
    body: undefined
  }, 'http://backend:4000');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.path, '/api/local-executor/v1/artifacts/artifact_1?token=short-lived');
  assert.equal(request.body, null);
});

test('unrelated GET remains blocked from the executor bridge', () => {
  assert.throws(() => buildForwardRequest({
    method: 'GET',
    originalUrl: '/api/local-executor/v1/jobs/job-1',
    headers: {},
    body: undefined
  }, 'http://backend:4000'), /path not allowed/);
});

assert.equal(PUBLIC_ARTIFACT_PATH.test('/api/local-executor/v1/artifacts/artifact_1'), true);
