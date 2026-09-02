const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function withBridge({ fetchConfig = {}, document, taskList }, fn) {
  let saved = structuredClone(document);
  const bodies = new Map();
  const taskPuts = [];
  const bodyPuts = [];
  const list = taskList || [saved];
  const taskPath = `/api/novel-fetch-workshop/tasks/${encodeURIComponent(document.bookId)}`;
  const bodyPrefix = `${taskPath}/bodies`;

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/config') {
      return send(200, { settings: { fetch: fetchConfig } });
    }
    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/tasks') {
      return send(200, { tasks: structuredClone(list) });
    }
    if (req.method === 'GET' && req.url === bodyPrefix) {
      const refs = [...bodies.values()].map(({ content, ...ref }) => ref);
      return send(200, { bodies: refs });
    }
    if (req.url?.startsWith(`${bodyPrefix}/`)) {
      const versionId = decodeURIComponent(req.url.slice(bodyPrefix.length + 1));
      if (req.method === 'PUT') {
        const body = await readJSON(req);
        bodyPuts.push({ versionId, body: structuredClone(body) });
        const previous = bodies.get(versionId);
        const ref = {
          versionId,
          revision: (previous?.revision || 0) + 1,
          contentHash: `hash-${versionId}`,
          charCount: String(body.content || '').length,
          state: body.state || 'ready',
          updatedAt: '2026-09-02T00:00:00.000Z',
          content: String(body.content || '')
        };
        bodies.set(versionId, ref);
        return send(200, ref);
      }
      if (req.method === 'GET') {
        const body = bodies.get(versionId);
        if (!body) return send(404, { error: 'not found' });
        return send(200, body);
      }
      if (req.method === 'DELETE') {
        const deleted = bodies.delete(versionId);
        return send(200, { deleted });
      }
    }
    if (req.url === taskPath) {
      if (req.method === 'GET') return send(200, saved);
      if (req.method === 'PUT') {
        const body = await readJSON(req);
        taskPuts.push(structuredClone(body));
        saved = { bookId: document.bookId, ...body };
        return send(200, { ok: true });
      }
    }
    send(404, { error: 'not found' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn({
      baseUrl: `http://127.0.0.1:${address.port}`,
      getSaved: () => structuredClone(saved),
      getTaskPuts: () => structuredClone(taskPuts),
      getBodyPuts: () => structuredClone(bodyPuts),
      bodies
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
    bodyRefs: {},
    logs: []
  };
}

test('MySQL workshop task list derives availability only from lightweight body refs', async () => {
  const bookId = '2074000000000000002';
  const document = seedDocument(bookId, '15');
  document.bodyRefs = {
    original: { versionId: 'original', revision: 1, contentHash: 'o', charCount: 10, state: 'ready' },
    ai1: { versionId: 'ai1', revision: 1, contentHash: 'a1', charCount: 11, state: 'ready' },
    ai3: { versionId: 'ai3', revision: 1, contentHash: 'a3', charCount: 12, state: 'ready' }
  };

  await withBridge({ document, taskList: [document] }, async ({ baseUrl }) => {
    const store = createMySQLWorkshopStore({
      targetBaseUrl: baseUrl,
      bridgeSecret: 'test-secret',
      account: { username: 'tester', isOwner: true }
    });
    const [task] = await store.listTasks('tester');
    assert.equal('original' in task, false);
    assert.equal('originalRaw' in task, false);
    assert.equal('versions' in task, false);
    assert.equal(task.hasOriginal, true);
    assert.equal(task.hasAi, true);
    assert.deepEqual(task.bodyVersions.sort(), ['ai1', 'ai3', 'original']);
  });
});

test('MySQL workshop fetch keeps selected platform fixed while honoring timeout and retries and persists body separately', async () => {
  const bookId = '2074000000000000003';
  await withBridge({
    fetchConfig: {
      endpoint: 'https://txt.121w.com/api.php',
      timeout_seconds: 9,
      retries: 1,
      auto_detect_platform: true
    },
    document: seedDocument(bookId, '15')
  }, async ({ baseUrl, getSaved, getTaskPuts, getBodyPuts }) => {
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
        return { code: 200, data: '第一章\r\n\r\n正文内容', bookinfo: { book_name: '测试小说' } };
      }
    });

    const result = await store.fetchOriginal('tester', bookId, 4000);

    assert.equal(result.status, 'done');
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.platformId), ['15', '15']);
    assert.deepEqual(calls.map(call => call.options.timeoutMs), [9000, 9000]);
    assert.deepEqual(calls.map(call => call.options.attempt), [1, 2]);

    const bodyPuts = getBodyPuts();
    assert.equal(bodyPuts.length, 1);
    assert.equal(bodyPuts[0].versionId, 'original');
    assert.deepEqual(bodyPuts[0].body, { content: '第一章\n正文内容', state: 'ready' });

    const saved = getSaved();
    assert.equal(saved.meta.platformId, '15');
    assert.equal(saved.meta.platformAutoDetected, false);
    assert.equal(saved.meta.originalStatus, 'done');
    assert.equal(saved.meta.bookName, '测试小说');
    assert.equal(saved.meta.originalRawChars, '第一章\r\n\r\n正文内容'.length);
    assert.equal(saved.meta.originalChars, '第一章\n正文内容'.length);
    assert.equal('original' in saved, false);
    assert.equal('originalRaw' in saved, false);
    assert.equal('versions' in saved, false);
    assert.equal(saved.bodyRefs.original.versionId, 'original');

    for (const taskPut of getTaskPuts()) {
      const serialized = JSON.stringify(taskPut);
      assert.equal(serialized.includes('第一章\r\n\r\n正文内容'), false);
      assert.equal(serialized.includes('第一章\n正文内容'), false);
    }
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
