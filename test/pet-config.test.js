const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { signBridgeRequest } = require('../routes/shuihuo-production');
const { requestGoConfig } = require('../routes/config');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('config gateway signs the Go platform config path and returns pet id', async () => {
  const secret = 'test-bridge-secret';
  const server = http.createServer((req, res) => {
    const issuedAt = req.headers['x-qiantie-issued-at'];
    const expected = signBridgeRequest(secret, {
      username: 'alice',
      isOwner: false,
      issuedAt,
      method: 'GET',
      pathname: '/api/platform/config'
    });
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/platform/config');
    assert.equal(req.headers['x-qiantie-username'], 'alice');
    assert.equal(req.headers['x-qiantie-is-owner'], 'false');
    assert.equal(req.headers['x-qiantie-signature'], expected);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ pet: 'pixiu' }));
  });
  const address = await listen(server);
  try {
    const result = await requestGoConfig(
      { targetBaseUrl: `http://127.0.0.1:${address.port}`, bridgeSecret: secret },
      { username: 'alice', isOwner: false },
      { method: 'GET' }
    );
    assert.equal(result.pet, 'pixiu');
  } finally {
    await close(server);
  }
});

test('config gateway sends only the requested pet id to Go', async () => {
  const secret = 'test-bridge-secret';
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/api/platform/config');
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), { pet: 'pixiu' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ pet: 'pixiu' }));
    });
  });
  const address = await listen(server);
  try {
    const result = await requestGoConfig(
      { targetBaseUrl: `http://127.0.0.1:${address.port}`, bridgeSecret: secret },
      { username: 'alice', isOwner: false },
      { method: 'POST', body: { pet: 'pixiu' } }
    );
    assert.equal(result.pet, 'pixiu');
  } finally {
    await close(server);
  }
});
