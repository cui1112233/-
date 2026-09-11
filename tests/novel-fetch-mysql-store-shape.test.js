const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

async function withWorkshopServer(payload, run) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/novel-fetch-workshop/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('V2 workshop listTasks preserves metadata when upstream returns JSON-string meta and snake_case envelope', async () => {
  const meta = {
    bookId: '7674515088685943832',
    bookName: '测试书名',
    platformId: '2',
    platformName: '番茄付费',
    style: '现代甜文',
    gender: '女频',
    originalStatus: 'done',
    originalChars: 1234,
    classifyStatus: 'classified',
    classifierModel: 'classifier-model',
    status: 'original_done'
  };

  await withWorkshopServer({
    tasks: [{
      book_id: meta.bookId,
      meta: JSON.stringify(meta),
      has_original: true,
      has_original_raw: true,
      has_ai: false,
      status: 'original_done',
      created_at: '2026-09-06T21:54:43+08:00',
      updated_at: '2026-09-06T21:55:00+08:00'
    }]
  }, async targetBaseUrl => {
    const store = createMySQLWorkshopStore({
      targetBaseUrl,
      bridgeSecret: 'test-secret',
      account: { username: 'tester', isOwner: false }
    });
    const rows = await store.listTasks('tester');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bookId, meta.bookId);
    assert.equal(rows[0].bookName, '测试书名');
    assert.equal(rows[0].platformId, '2');
    assert.equal(rows[0].platformName, '番茄付费');
    assert.equal(rows[0].style, '现代甜文');
    assert.equal(rows[0].gender, '女频');
    assert.equal(rows[0].originalStatus, 'done');
    assert.equal(rows[0].classifyStatus, 'classified');
    assert.equal(rows[0].hasOriginal, true);
    assert.equal(rows[0].hasOriginalRaw, true);
    assert.equal(rows[0].createdAt, '2026-09-06T21:54:43+08:00');
    assert.equal(rows[0].updatedAt, '2026-09-06T21:55:00+08:00');
  });
});
