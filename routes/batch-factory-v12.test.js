const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchBatchFactoryOriginals,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations
} = require('./batch-factory-v12');

test('batch factory direct fetch returns per-book results without creating Novel Fetch tasks', async () => {
  const calls = [];
  const response = await fetchBatchFactoryOriginals({
    platform: '15',
    bookIds: ['2084012035524801698', '2084012035524801699'],
    maxTxt: 4000
  }, async input => {
    calls.push(input);
    if (input.bookId.endsWith('1699')) throw new Error('获取书籍信息失败');
    return { ...input, text: '正文', rawText: '正文', attempts: 1, bookinfo: { work_title: '白月光回港' } };
  });

  assert.deepEqual(calls, [
    { bookId: '2084012035524801698', platformId: '15', maxTxt: 4000 },
    { bookId: '2084012035524801699', platformId: '15', maxTxt: 4000 }
  ]);
  assert.equal(response.results[0].status, 'ok');
  assert.equal(response.results[0].data, '正文');
  assert.equal(response.results[0].bookinfo.work_title, '白月光回港');
  assert.deepEqual(response.results[1], {
    bookId: '2084012035524801699',
    platform: 15,
    status: 'error',
    data: null,
    error: '获取书籍信息失败',
    length: 0
  });
});

test('rewrites only the V12 batch-factory namespace for the legacy compatibility adapter', () => {
  assert.equal(
    rewriteV12PathForLegacyRead('/api/batch-factory/v12/batches/batch-1/books/book-1/stages/director'),
    '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/director'
  );
  assert.equal(rewriteV12PathForLegacyRead('/api/batch-factory/v11/batches/batch-1'), '');
  assert.equal(rewriteV12PathForLegacyRead('/api/shuihuo-production/projects'), '');
});

test('keeps native H3 director, audio, compile and trace requests in the V12 namespace', () => {
  assert.equal(
    routeV12UpstreamPath('/api/batch-factory/v12/batches/batch-1/books/book-1/h3/compile'),
    '/api/batch-factory/v12/batches/batch-1/books/book-1/h3/compile'
  );
  assert.equal(
    routeV12UpstreamPath('/api/batch-factory/v12/batches/batch-1/books/book-1/h3/trace?compilationId=compile-1'),
    '/api/batch-factory/v12/batches/batch-1/books/book-1/h3/trace?compilationId=compile-1'
  );
  assert.equal(
    routeV12UpstreamPath('/api/batch-factory/v12/batches/batch-1/books/book-1/h3/director'),
    '/api/batch-factory/v12/batches/batch-1/books/book-1/h3/director'
  );
  assert.equal(
    routeV12UpstreamPath('/api/batch-factory/v12/batches/batch-1/books/book-1/h3/audio-measurement'),
    '/api/batch-factory/v12/batches/batch-1/books/book-1/h3/audio-measurement'
  );
  assert.equal(
    routeV12UpstreamPath('/api/batch-factory/v12/batches/batch-1/books/book-1/stages/director'),
    '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/director'
  );
});

test('keeps the public V11 namespace read-only after V12 becomes the production entry', () => {
  let continued = false;
  const result = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  rejectLegacyV11Mutations({ method: 'POST' }, result, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(result.statusCode, 410);
  assert.equal(result.body.code, 'BATCH_FACTORY_V11_READ_ONLY');

  rejectLegacyV11Mutations({ method: 'GET' }, result, () => { continued = true; });
  assert.equal(continued, true);
});
