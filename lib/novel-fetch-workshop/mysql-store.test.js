const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

const { createMySQLWorkshopStore } = require('./mysql-store');

test('workshop store signs bridge requests with the recovery backend canonical payload', async () => {
  const secret = 'bridge-secret';
  const server = http.createServer((request, response) => {
    const username = request.headers['x-qiantie-username'];
    const issuedAt = request.headers['x-qiantie-issued-at'];
    const isOwner = request.headers['x-qiantie-is-owner'];
    const expected = crypto.createHmac('sha256', secret)
      .update([username, issuedAt, isOwner, request.method, request.url].join('\n'))
      .digest('hex');
    if (request.headers['x-qiantie-signature'] !== expected) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ tasks: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const store = createMySQLWorkshopStore({
      targetBaseUrl: `http://127.0.0.1:${address.port}`,
      bridgeSecret: secret,
      account: { username: 'alice', isOwner: false }
    });
    assert.deepEqual(await store.listTasks('alice'), []);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('direct original fetch reuses Novel Fetch configured endpoint without creating a task', async () => {
  const upstreamCalls = [];
  const server = http.createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/novel-fetch-workshop/config');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ settings: { fetch: {
      endpoint: 'https://configured.example/fetch/{bookid}/{platform}/{max_txt}',
      default_max_txt: 4000,
      timeout_seconds: 12,
      retries: 0
    } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const store = createMySQLWorkshopStore({
      targetBaseUrl: `http://127.0.0.1:${address.port}`,
      bridgeSecret: 'bridge-secret',
      account: { username: 'alice', isOwner: false },
      fetchUpstream: async (bookId, platformId, maxTxt, options) => {
        upstreamCalls.push({ bookId, platformId, maxTxt, options });
        return { code: 200, data: '\n第一行\n\n第二行\n', bookinfo: { work_title: '白月光回港' } };
      }
    });

    const result = await store.fetchDirectOriginal({
      bookId: '2084012035524801698',
      platformId: '15',
      maxTxt: 4000
    });

    assert.deepEqual(result, {
      bookId: '2084012035524801698',
      platformId: '15',
      text: '第一行\n第二行',
      rawText: '\n第一行\n\n第二行\n',
      attempts: 1,
      bookinfo: { work_title: '白月光回港' }
    });
    assert.deepEqual(upstreamCalls, [{
      bookId: '2084012035524801698',
      platformId: '15',
      maxTxt: 4000,
      options: {
        endpoint: 'https://configured.example/fetch/{bookid}/{platform}/{max_txt}',
        timeoutMs: 12000,
        attempt: 1
      }
    }]);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
