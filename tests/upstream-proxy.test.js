const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  buildModelsUrl,
  collectResponse,
  requestUpstreamModels,
  resolveUpstreamProxyUrl
} = require('../lib/shared');

test('upstream proxy prefers the Qiantie setting over standard proxy environment variables', () => {
  assert.equal(resolveUpstreamProxyUrl({
    QIANTIE_HTTPS_PROXY: 'http://127.0.0.1:7893',
    HTTPS_PROXY: 'http://127.0.0.1:9999'
  }), 'http://127.0.0.1:7893/');
  assert.equal(resolveUpstreamProxyUrl({ HTTPS_PROXY: 'http://127.0.0.1:7893' }), 'http://127.0.0.1:7893/');
  assert.equal(resolveUpstreamProxyUrl({}), '');
});

test('buildModelsUrl normalizes OpenAI-compatible base URLs', () => {
  assert.equal(buildModelsUrl('https://gateway.example/v1'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example/v1/'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example/models'), 'https://gateway.example/v1/models');
  assert.equal(buildModelsUrl('https://gateway.example/v1/models'), 'https://gateway.example/v1/models');
  assert.throws(() => buildModelsUrl(''), /Base URL is required/);
});

test('model catalog lookup rejects non-HTTP protocols before selecting a transport', async () => {
  await assert.rejects(
    requestUpstreamModels({ baseUrl: 'ftp://gateway.example', apiKey: 'test-image-key' }, collectResponse),
    error => error?.code === 'UPSTREAM_PROTOCOL_INVALID' && /HTTP or HTTPS/.test(error.message)
  );
});

test('model catalog lookup uses GET without a payload and sends the API key', async () => {
  const observed = {};
  const server = http.createServer((req, res) => {
    observed.method = req.method;
    observed.url = req.url;
    observed.authorization = req.headers.authorization;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      observed.body = Buffer.concat(chunks).toString('utf8');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'test-image-model' }] }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const upstream = await requestUpstreamModels({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-image-key'
    }, collectResponse);

    assert.equal(upstream.statusCode, 200);
    assert.equal(observed.method, 'GET');
    assert.equal(observed.url, '/v1/models');
    assert.equal(observed.authorization, 'Bearer test-image-key');
    assert.equal(observed.body, '');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('model catalog lookup uses the configured proxy for HTTPS targets', async () => {
  const observed = {};
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    observed.target = req.url;
    socket.destroy();
  });

  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  const originalProxy = process.env.QIANTIE_HTTPS_PROXY;
  process.env.QIANTIE_HTTPS_PROXY = `http://127.0.0.1:${address.port}`;
  try {
    // Actual TLS handshake compatibility is verified by the live no-key smoke test.
    await assert.rejects(
      requestUpstreamModels({ baseUrl: 'https://catalog.example', apiKey: 'test-image-key' }, collectResponse, { timeoutMs: 1000 }),
      error => error instanceof Error
    );
    assert.equal(observed.target, 'catalog.example:443');
  } finally {
    if (originalProxy === undefined) delete process.env.QIANTIE_HTTPS_PROXY;
    else process.env.QIANTIE_HTTPS_PROXY = originalProxy;
    await new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
  }
});
