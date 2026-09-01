const test = require('node:test');
const assert = require('node:assert/strict');
const { ExecutorApiClient } = require('../src/api-client');

test('artifact upload sends raw MP4 bytes with device and lease credentials', async () => {
  const seen = [];
  const client = new ExecutorApiClient({
    baseUrl: 'https://v78.example',
    fetchImpl: async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200, text: async () => JSON.stringify({ artifactId: 'artifact-1' }) };
    }
  });
  const bytes = Buffer.from('00000018667479706d703432', 'hex');
  const result = await client.uploadArtifact('device-token', 'job/a', { leaseToken: 'lease-secret', leaseGeneration: 7 }, bytes);
  assert.equal(result.artifactId, 'artifact-1');
  const [url, init] = seen[0];
  assert.equal(url, 'https://v78.example/api/local-executor/v1/jobs/job%2Fa/artifact');
  assert.equal(init.headers.Authorization, 'Bearer device-token');
  assert.equal(init.headers['Content-Type'], 'video/mp4');
  assert.equal(init.headers['X-Lease-Token'], 'lease-secret');
  assert.equal(init.headers['X-Lease-Generation'], '7');
  assert.equal(Buffer.compare(Buffer.from(init.body), bytes), 0);
});
