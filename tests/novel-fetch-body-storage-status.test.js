const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createNovelFetchLifecycleClient } = require('../lib/novel-fetch-workshop/lifecycle-client');

test('lifecycle client reads owner-scoped body storage status through signed Go bridge', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      username: req.headers['x-qiantie-username'],
      signature: req.headers['x-qiantie-signature']
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ bodyCount: 9, storageBytes: 4096, charCount: 12000, releasableCount: 4, expiredCount: 2 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const client = createNovelFetchLifecycleClient({
      targetBaseUrl: `http://127.0.0.1:${address.port}`,
      bridgeSecret: 'test-secret',
      account: { username: 'alice', isOwner: true }
    });
    const status = await client.getBodyStorageStatus();
    assert.deepEqual(status, { bodyCount: 9, storageBytes: 4096, charCount: 12000, releasableCount: 4, expiredCount: 2 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, '/api/novel-fetch-workshop/bodies/status');
    assert.equal(requests[0].username, 'alice');
    assert.ok(requests[0].signature);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
