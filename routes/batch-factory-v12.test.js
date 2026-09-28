const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyBatchFactoryBooks,
  fetchBatchFactoryOriginals,
  refillMissingBatchFactoryBookSource,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations
} = require('./batch-factory-v12');

test('classifies every fetched book independently without letting one failure block the others', async () => {
  const calls = [];
  const result = await classifyBatchFactoryBooks({
    books: [
      { id: 'book-1', sourceText: '正文一', sourceMetadata: {} },
      { id: 'book-2', sourceText: '正文二', sourceMetadata: { gender: '女频', style: '现代甜文' } },
      { id: 'book-3', sourceText: '', sourceMetadata: {} },
      { id: 'book-4', sourceText: '正文四', sourceMetadata: {} }
    ],
    classifyBook: async book => {
      calls.push(book.id);
      if (book.id === 'book-4') throw new Error('文本模型暂不可用');
      return { classification: { gender: '男频', style: '男频都市' }, reused: false };
    }
  });

  assert.deepEqual(calls, ['book-1', 'book-4']);
  assert.deepEqual(result, [
    { bookId: 'book-1', status: 'classified', classification: { gender: '男频', style: '男频都市' }, reused: false },
    { bookId: 'book-2', status: 'reused', classification: { gender: '女频', style: '现代甜文', tags: '', reason: '' }, reused: true },
    { bookId: 'book-3', status: 'skipped', reason: 'SOURCE_TEXT_REQUIRED' },
    { bookId: 'book-4', status: 'failed', error: '文本模型暂不可用' }
  ]);
});
const { automationCompilePayload } = require('./batch-factory-v11');

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

test('refills a legacy empty book from its stored platform and book ID without overwriting an existing source', async () => {
  const calls = [];
  const result = await refillMissingBatchFactoryBookSource({
    book: { id: 'book-1', bookId: '2084012035524801698', platform: '15', revision: 7, sourceText: '', sourceMetadata: { contentCaptureCharacters: 4000 } },
    fetchDirectOriginal: async input => { calls.push(input); return { text: '抓回来的正文', attempts: 2, bookinfo: { work_title: '白月光回港' } }; },
    captureSource: async input => { calls.push(input); return { book: { ...input, id: 'book-1' } }; },
    now: () => new Date('2026-09-22T00:00:00.000Z')
  });
  assert.deepEqual(calls, [
    { bookId: '2084012035524801698', platformId: '15', maxTxt: 4000 },
    {
      sourceText: '抓回来的正文', expectedRevision: 7,
      sourceMetadata: {
        sourceMode: 'manual_refetched', sourceFetchedAt: '2026-09-22T00:00:00.000Z',
        sourceFetchAttempts: 2, sourceCaptureCharacters: 4000, sourceBookId: '2084012035524801698', sourceBookTitle: '白月光回港'
      }
    }
  ]);
  assert.equal(result.book.sourceText, '抓回来的正文');
  await assert.rejects(() => refillMissingBatchFactoryBookSource({ book: { id: 'book-1', sourceText: '已存在正文' }, fetchDirectOriginal: async () => ({}) }), /已有正文/);
});

test('uses the leading stored Book ID when a legacy smart parse appended the title', async () => {
  const calls = [];
  await refillMissingBatchFactoryBookSource({
    book: { id: 'book-1', bookId: '2085148147785918287 阿芙', platform: '15', revision: 1, sourceText: '', sourceMetadata: { contentCaptureCharacters: 4000 } },
    fetchDirectOriginal: async input => { calls.push(input); return { text: '正文' }; },
    captureSource: async input => ({ book: input })
  });
  assert.equal(calls[0].bookId, '2085148147785918287');
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

test('maps all enabled script constraint layers into automated H3 compilation', () => {
  const payload = automationCompilePayload({ directorRevision: { id: 'director-1' } }, {
    storyboardDurationLimit: 10,
    aiPromptConfig: {
      video: { presetKey: 'v11-director-normal', presetVersion: 1, body: '【批量工厂最终 Prompt 模板】\n{{storyboard}}' },
      constraints: {
        enabled: true,
        baseSetup: { enabled: true },
        enabledCategories: ['prefix', 'quality', 'restriction', 'negative'],
        selections: [
          { constraintCategory: 'prefix', presetId: 'script-constraint-prefix-live-action', body: 'PREFIX' },
          { constraintCategory: 'quality', presetId: 'script-constraint-quality-4k', body: 'QUALITY' },
          { constraintCategory: 'restriction', presetId: 'script-constraint-restriction-no-overlay', body: 'RESTRICTION' },
          { constraintCategory: 'negative', presetId: 'script-constraint-negative-general', body: 'NEGATIVE' }
        ]
      }
    }
  });
  assert.deepEqual(payload.switches, { smart_unified: false, base_setup: true, prefix: true, quality: true, visual_restriction: true, negative: true });
  assert.equal(payload.prefix_text, 'PREFIX');
  assert.equal(payload.quality_text, 'QUALITY');
  assert.equal(payload.visual_restriction_text, 'RESTRICTION');
  assert.equal(payload.negative_text, 'NEGATIVE');
  assert.equal(payload.preset.key, 'v11-director-normal');
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
