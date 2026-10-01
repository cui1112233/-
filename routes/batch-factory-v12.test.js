const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyBatchFactoryBooks,
  batchFactoryBatchListSummary,
  fetchBatchFactoryOriginals,
  refillMissingBatchFactoryBookSource,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations
} = require('./batch-factory-v12');

test('lists batch projects without serializing their full source and storyboard payloads', () => {
  const result = batchFactoryBatchListSummary({
    id: 'batch-1',
    title: '测试批量',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    revision: 3,
    settingsState: { patch: { textModelId: 'text-1' } },
    books: [{
      id: 'book-1', bookId: '558154', title: '后来情深情亦浅', platform: '七猫',
      sourceText: '这里是一大段不该进入项目列表的正文',
      sourceMetadata: { gender: '女频' },
      directorRevision: { output: { h3_director: { director_cards: [{ source_text: '不该进入列表' }] } } },
      videos: [{ id: 'video-1', prompt: '不该进入列表' }]
    }]
  });

  assert.deepEqual(result, {
    id: 'batch-1', title: '测试批量', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    revision: 3, bookCount: 1,
    books: [{ id: 'book-1', bookId: '558154', title: '后来情深情亦浅', platform: '七猫' }]
  });
});

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

test('removes book-city loading remnants from production text but keeps the upstream raw backup', async () => {
  const response = await fetchBatchFactoryOriginals({
    platform: '3',
    bookIds: ['558154'],
    maxTxt: 4000
  }, async () => ({
    text: '修改中&nbsp;\n修改中&nbsp;\n。\n\n第一段 <b>正文</b>\n第二段正文',
    rawText: '修改中&nbsp;\n修改中&nbsp;\n。\n\n第一段 <b>正文</b>\n第二段正文'
  }));

  assert.equal(response.results[0].data, '第一段 正文\n第二段正文');
  assert.equal(response.results[0].rawData, '修改中&nbsp;\n修改中&nbsp;\n。\n\n第一段 <b>正文</b>\n第二段正文');
  assert.equal(response.results[0].length, '第一段 正文\n第二段正文'.length);
});

test('refills a legacy empty book from its stored platform and book ID without overwriting an existing source', async () => {
  const calls = [];
  const result = await refillMissingBatchFactoryBookSource({
    book: { id: 'book-1', bookId: '2084012035524801698', platform: '15', revision: 7, sourceText: '', sourceMetadata: { contentCaptureCharacters: 4000 } },
    fetchDirectOriginal: async input => { calls.push(input); return { text: '修改中&nbsp;\n。\n抓回来的正文', rawText: '修改中&nbsp;\n。\n抓回来的正文', attempts: 2, bookinfo: { work_title: '白月光回港' } }; },
    captureSource: async input => { calls.push(input); return { book: { ...input, id: 'book-1' } }; },
    now: () => new Date('2026-09-22T00:00:00.000Z')
  });
  assert.deepEqual(calls, [
    { bookId: '2084012035524801698', platformId: '15', maxTxt: 4000 },
    {
      sourceText: '抓回来的正文', expectedRevision: 7,
      sourceMetadata: {
        contentCaptureCharacters: 4000,
        sourceMode: 'manual_refetched', sourceFetchedAt: '2026-09-22T00:00:00.000Z',
        sourceFetchAttempts: 2, sourceCaptureCharacters: 4000, sourceBookId: '2084012035524801698', sourceBookTitle: '白月光回港',
        sourceOriginalRaw: '修改中&nbsp;\n。\n抓回来的正文'
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

test('resolves stored platform display names back to numeric book-store IDs before refetching', async () => {
  const platforms = [{ id: '2', name: '番茄付费' }, { id: '3', name: '七猫付费' }, { id: '7', name: '番茄免费' }];
  const calls = [];
  const fetchDirectOriginal = async input => { calls.push(input); return { text: '正文内容', attempts: 1 }; };
  const captureSource = async input => ({ ok: true, ...input });
  const book = { bookId: '123456', sourceText: '', revision: 1, sourceMetadata: { contentCaptureCharacters: 4000 } };

  // 显示名"七猫"唯一前缀匹配到"七猫付费" → '3'
  await refillMissingBatchFactoryBookSource({ book: { ...book, platform: '七猫' }, platforms, fetchDirectOriginal, captureSource });
  assert.equal(calls.at(-1).platformId, '3');
  // 数字 ID 原样通过，manual 书不受影响
  await refillMissingBatchFactoryBookSource({ book: { ...book, platform: '3' }, platforms, fetchDirectOriginal, captureSource });
  assert.equal(calls.at(-1).platformId, '3');
  // "番茄"同时命中番茄付费/番茄免费，不猜，原样传给上游由其报错
  await refillMissingBatchFactoryBookSource({ book: { ...book, platform: '番茄' }, platforms, fetchDirectOriginal, captureSource });
  assert.equal(calls.at(-1).platformId, '番茄');
  // 多平台存档"七猫 / 番茄"取首段解析为 '3'
  await refillMissingBatchFactoryBookSource({ book: { ...book, platform: '七猫 / 番茄' }, platforms, fetchDirectOriginal, captureSource });
  assert.equal(calls.at(-1).platformId, '3');
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
