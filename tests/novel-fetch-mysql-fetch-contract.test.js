const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

async function withBridge({ fetchConfig, document }, fn) {
  let saved = structuredClone(document);
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/config') {
      return send(200, { settings: { fetch: fetchConfig } });
    }
    if (req.url === `/api/novel-fetch-workshop/tasks/${encodeURIComponent(document.bookId)}`) {
      if (req.method === 'GET') return send(200, saved);
      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          saved = { bookId: document.bookId, ...body };
          send(200, { ok: true });
        });
        return;
      }
    }
    send(404, { error: 'not found' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn({
      baseUrl: `http://127.0.0.1:${address.port}`,
      getSaved: () => structuredClone(saved)
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function seedDocument(bookId, platformId = '15') {
  return {
    bookId,
    meta: {
      bookId,
      bookName: '',
      platformId,
      platformName: '知乎付费',
      status: 'created',
      originalStatus: ''
    },
    original: '',
    originalRaw: '',
    versions: {},
    logs: []
  };
}

test('MySQL workshop fetch keeps selected platform fixed while honoring timeout and retries', async () => {
  const bookId = '2074000000000000003';
  await withBridge({
    fetchConfig: {
      endpoint: 'https://txt.121w.com/api.php',
      timeout_seconds: 9,
      retries: 1,
      auto_detect_platform: true
    },
    document: seedDocument(bookId, '15')
  }, async ({ baseUrl, getSaved }) => {
    const calls = [];
    const store = createMySQLWorkshopStore({
      targetBaseUrl: baseUrl,
      bridgeSecret: 'test-secret',
      account: { username: 'tester', isOwner: true },
      fetchUpstream: async (receivedBookId, platformId, maxTxt, options) => {
        calls.push({ receivedBookId, platformId, maxTxt, options });
        if (calls.length === 1) {
          const error = new Error('temporary');
          error.recoverable = true;
          throw error;
        }
        return { code: 200, data: '正文内容', bookinfo: { book_name: '测试小说' } };
      }
    });

    const result = await store.fetchOriginal('tester', bookId, 4000);

    assert.equal(result.status, 'done');
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.platformId), ['15', '15']);
    assert.deepEqual(calls.map(call => call.options.timeoutMs), [9000, 9000]);
    assert.deepEqual(calls.map(call => call.options.attempt), [1, 2]);

    const saved = getSaved();
    assert.equal(saved.meta.platformId, '15');
    assert.equal(saved.meta.platformAutoDetected, false);
    assert.equal(saved.meta.originalStatus, 'done');
    assert.equal(saved.originalRaw, '正文内容');
    assert.equal(saved.original, '正文内容');
    assert.equal(saved.meta.bookName, '测试小说');
  });
});

test('legacy auto_detect_platform=true never causes cross-platform fallback in V78', async () => {
  const bookId = '2074000000000000004';
  await withBridge({
    fetchConfig: {
      endpoint: 'https://txt.121w.com/api.php',
      timeout_seconds: 5,
      retries: 0,
      auto_detect_platform: true
    },
    document: seedDocument(bookId, '15')
  }, async ({ baseUrl, getSaved }) => {
    const platforms = [];
    const store = createMySQLWorkshopStore({
      targetBaseUrl: baseUrl,
      bridgeSecret: 'test-secret',
      account: { username: 'tester', isOwner: true },
      fetchUpstream: async (_bookId, platformId) => {
        platforms.push(platformId);
        return { code: 404, msg: '该平台没有正文' };
      }
    });

    const result = await store.fetchOriginal('tester', bookId, 4000);

    assert.equal(result.status, 'failed');
    assert.deepEqual(platforms, ['15']);
    const saved = getSaved();
    assert.equal(saved.meta.platformId, '15');
    assert.equal(saved.meta.originalStatus, 'failed');
  });
});

test('MySQL workshop fetch records explicit empty-source failure without false success', async () => {
  const bookId = '2074000000000000005';
  await withBridge({
    fetchConfig: { endpoint: 'https://txt.121w.com/api.php', timeout_seconds: 5, retries: 0 },
    document: seedDocument(bookId, '15')
  }, async ({ baseUrl, getSaved }) => {
    const store = createMySQLWorkshopStore({
      targetBaseUrl: baseUrl,
      bridgeSecret: 'test-secret',
      account: { username: 'tester', isOwner: true },
      fetchUpstream: async () => ({ code: 200, data: '' })
    });

    const result = await store.fetchOriginal('tester', bookId, 4000);

    assert.deepEqual(result, { status: 'failed', attempts: 1, code: 'EMPTY_ORIGINAL' });
    const saved = getSaved();
    assert.equal(saved.meta.originalStatus, 'failed');
    assert.equal(saved.meta.originalFetchAttempts, 1);
    assert.equal(saved.meta.originalErrorCode, 'EMPTY_ORIGINAL');
    assert.equal(saved.logs.at(-1).event, 'original_fetch_failed');
    assert.equal(saved.logs.at(-1).data.code, 'EMPTY_ORIGINAL');
  });
});
