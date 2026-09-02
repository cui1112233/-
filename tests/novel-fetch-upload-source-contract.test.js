const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');
const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-fetch-upload.js'), 'utf8');

function routeHandler(router, method, routePath) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} missing`);
  return layer.route.stack[0].handle;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('novel-fetch upload route is Browser Worker only and contains no legacy PHP cookie login path', () => {
  assert.match(source, /create121BrowserClient/);
  assert.match(source, /browserClient\.login/);
  assert.match(source, /browserClient\.test/);
  assert.match(source, /browserClient\.action/);
  assert.match(source, /readVersionText/);
  assert.match(source, /getBrowserSession/);
  assert.match(source, /setBrowserSession/);
  assert.doesNotMatch(source, /buildLoginRequest/);
  assert.doesNotMatch(source, /\.getSession\(/);
  assert.doesNotMatch(source, /\.setSession\(/);
  assert.doesNotMatch(source, /Cookie\s*:/);
  assert.doesNotMatch(source, /PHPSESSID/);
});

test('workshop ai3 uploads from Body Store without creating a real txt file and uses configured retention only after success', async () => {
  const bridgeRequests = [];
  const events = [];
  let releasePayload = null;
  const bridge = http.createServer((req, res) => {
    bridgeRequests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/config') {
      res.end(JSON.stringify({ settings: { storage: { cleanup_enabled: true, retention_days: 12 } } }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/tasks/123456/bodies/ai3') {
      res.end(JSON.stringify({
        bookId: '123456',
        versionId: 'ai3',
        revision: 2,
        contentHash: 'hash-ai3',
        charCount: 8,
        state: 'ready',
        content: 'AI3本地正文内容'
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/tasks/123456') {
      res.end(JSON.stringify({
        bookId: '123456',
        meta: { gender: '女', style: '现代甜文' },
        bodyRefs: { ai3: { versionId: 'ai3', revision: 2, state: 'ready' } },
        logs: []
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/novel-fetch-workshop/tasks/123456/bodies/ai3/release') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        releasePayload = raw ? JSON.parse(raw) : {};
        events.push('release');
        res.end(JSON.stringify({
          versionId: 'ai3',
          revision: 2,
          state: 'releasable',
          releasableAt: '2026-09-02T15:30:00Z',
          expiresAt: '2026-09-14T15:30:00Z'
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-body-upload-'));
  const diskTxt = path.join(tempDir, '123456.txt');
  const calls = [];
  const store = {
    getBrowserSession() {
      return { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
    }
  };
  const browserClient = {
    configured: true,
    async action(input) {
      calls.push(input);
      events.push('121-success');
      return { ok: true, body: JSON.stringify({ success: true, result: { success: { count: 1, files: ['123456.txt'] }, failed: { count: 0, files: [] } } }) };
    }
  };

  try {
    const address = bridge.address();
    const router = createNovelFetchUploadRouter({
      auth: (_req, _res, next) => next(),
      store,
      browserClient,
      workshopGateway: { targetBaseUrl: `http://127.0.0.1:${address.port}`, bridgeSecret: 'test-secret' }
    });
    const handler = routeHandler(router, 'post', '/upload-batch');
    const res = response();

    assert.equal(fs.existsSync(diskTxt), false);
    await handler({
      username: 'alice',
      auth: { account: { username: 'alice', isOwner: true } },
      body: {
        platformId: 2,
        advanced: {},
        items: [{ bookId: '123456', source: 'workshop', version: 'ai3' }]
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.results[0].status, 'ok');
    assert.equal(fs.existsSync(diskTxt), false);
    assert.equal(bridgeRequests.includes('GET /api/novel-fetch-workshop/config'), true);
    assert.equal(bridgeRequests.includes('GET /api/novel-fetch-workshop/tasks/123456/bodies/ai3'), true);
    assert.equal(bridgeRequests.includes('POST /api/novel-fetch-workshop/tasks/123456/bodies/ai3/release'), true);
    assert.deepEqual(releasePayload, { retentionDays: 12 });
    assert.deepEqual(events, ['121-success', 'release']);
    assert.equal(calls.length, 1);

    const multipart = Buffer.from(calls[0].payload.bodyBase64, 'base64').toString('utf8');
    assert.match(multipart, /name="files\[\]"/);
    assert.match(multipart, /filename="123456\.txt"/);
    assert.match(multipart, /Content-Type: text\/plain/);
    assert.match(multipart, /AI3本地正文内容/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await new Promise(resolve => bridge.close(resolve));
  }
});
