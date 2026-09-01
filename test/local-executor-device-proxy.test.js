const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForwardRequest } = require('../lib/local-executor-device-forwarder');

test('pair body is forwarded to internal Go path', () => {
  const built = buildForwardRequest({
    method: 'POST', originalUrl: '/api/local-executor/v1/pair',
    headers: { 'content-type': 'application/json' }, body: { code: 'ABCDE-FGHIJ' }
  }, 'http://backend:4000');
  assert.equal(built.options.hostname, 'backend');
  assert.equal(built.options.port, '4000');
  assert.equal(built.options.path, '/api/local-executor/v1/pair');
  assert.deepEqual(JSON.parse(built.body.toString()), { code: 'ABCDE-FGHIJ' });
});

test('heartbeat and jobs preserve executor bearer token', () => {
  for (const path of ['/api/local-executor/v1/heartbeat', '/api/local-executor/v1/jobs/claim', '/api/local-executor/v1/jobs/j1/progress']) {
    const built = buildForwardRequest({
      method: 'POST', originalUrl: path,
      headers: { authorization: 'Bearer device-secret', 'content-type': 'application/json' }, body: {}
    }, 'http://backend:4000');
    assert.equal(built.options.headers.Authorization, 'Bearer device-secret');
    assert.equal(built.options.path, path);
  }
});

test('MP4 artifact upload is marked for streaming and preserves lease headers', () => {
  const built = buildForwardRequest({
    method: 'POST',
    originalUrl: '/api/local-executor/v1/jobs/j1/artifact',
    headers: {
      authorization: 'Bearer device-secret',
      'content-type': 'video/mp4',
      'content-length': '12345',
      'x-lease-token': 'lease-secret',
      'x-lease-generation': '9'
    }
  }, 'http://backend:4000');
  assert.equal(built.streamBody, true);
  assert.equal(built.body, null);
  assert.equal(built.options.headers['X-Lease-Token'], 'lease-secret');
  assert.equal(built.options.headers['X-Lease-Generation'], '9');
  assert.equal(built.options.headers['Content-Length'], '12345');
});

test('arbitrary paths and methods are rejected', () => {
  assert.throws(() => buildForwardRequest({ method: 'POST', originalUrl: '/api/admin', headers: {}, body: {} }, 'http://backend:4000'), /not allowed/);
  assert.throws(() => buildForwardRequest({ method: 'GET', originalUrl: '/api/local-executor/v1/heartbeat', headers: {} }, 'http://backend:4000'), /not allowed/);
});
