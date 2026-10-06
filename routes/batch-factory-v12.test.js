const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  classifyBatchFactoryBooks,
  batchFactoryBatchListSummary,
  fetchBatchFactoryOriginals,
  refillMissingBatchFactoryBookSource,
  buildGiantBatchCreatePayload,
  routeV12UpstreamPath,
  rewriteV12PathForLegacyRead,
  rejectLegacyV11Mutations,
  createBatchFactoryV12Router
} = require('./batch-factory-v12');
const { refillMissingBatchFactoryBookSource: refillSharedBatchFactoryBookSource, backfillBatchFactoryBook121Metadata } = require('../lib/batch-factory-v11/source-refill');

const dispatchValidationCases = [
  { name: 'video stage inherits and rejects a disabled persisted batch video model', path: 'stages/video', batchPatch: { videoModelId: 'video-disabled' }, body: { mode: 'missing', textModelId: 'text-1', provider: 'doubao_local_executor' }, status: 422, message: /视频模型不可用/ },
  { name: 'manual retry rejects a disabled inherited video selection before dispatch', path: 'stages/retry', batchPatch: { videoModelId: 'video-disabled' }, body: { textModelId: 'text-1' }, status: 422, message: /视频模型不可用/ },
  { name: 'book production rejects a disabled inherited video selection before dispatch', path: 'production', batchPatch: { videoModelId: 'video-disabled' }, body: { provider: 'doubao_local_executor' }, status: 422, message: /视频模型不可用/ },
  { name: 'native H3 director rejects a wrong-kind explicit image selection', path: 'h3/director', body: { textModelId: 'text-1', imageModelId: 'text-1' }, status: 422, message: /图片模型不可用/ },
  { name: 'native H3 director rejects a removed explicit video selection', path: 'h3/director', body: { textModelId: 'text-1', videoModelId: 'video-removed' }, status: 422, message: /视频模型不可用/ },
  { name: 'native H3 director inherits and rejects a wrong-kind persisted image selection', path: 'h3/director', batchPatch: { imageModelId: 'text-1' }, body: { textModelId: 'text-1' }, status: 422, message: /图片模型不可用/ },
  { name: 'native H3 director inherits and rejects a removed persisted video selection', path: 'h3/director', batchPatch: { videoModelId: 'video-removed' }, body: { textModelId: 'text-1' }, status: 422, message: /视频模型不可用/ },
  { name: 'video stage retains a valid explicit book model over a disabled batch default', path: 'stages/video', batchPatch: { videoModelId: 'video-disabled' }, bookPatch: { videoModelId: 'local-doubao-executor-video' }, body: { textModelId: 'text-1', provider: 'doubao_local_executor' }, status: 201 },
  { name: 'video stage retains valid batch inheritance when book model fields are missing', path: 'stages/video', batchPatch: { videoModelId: 'local-doubao-executor-video' }, body: { textModelId: 'text-1', provider: 'doubao_local_executor' }, status: 201 }
];

for (const fixture of dispatchValidationCases) {
  test(`V12 ${fixture.name}`, async t => {
    const calls = [];
    const batch = { id: 'batch-1', settingsState: { patch: { textModelId: 'text-1', ...fixture.batchPatch } },
      books: [{ id: 'book-1', settingsState: { patch: fixture.bookPatch || {} } }] };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.username = 'alice'; next(); });
    app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
      goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
      memberStore: { getMember: username => ({ username, active: true, role: 'manager' }) },
      configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [
        { id: 'text-1', kind: 'text', enabled: true, baseUrl: 'https://text.example/v1', modelId: 'text-provider', credential: 'test-key' },
        { id: 'video-disabled', kind: 'video', enabled: false, credential: 'test-key' },
        { id: 'local-doubao-executor-video', kind: 'video', enabled: true, executorPaired: true }
      ] }),
      fetchImpl: async (url, init) => {
        calls.push({ method: init.method, pathname: new URL(url).pathname, payload: init.body ? JSON.parse(init.body) : undefined });
        return new Response(JSON.stringify(init.method === 'GET' ? { batch } : { dispatched: true }), { status: init.method === 'GET' ? 200 : 201 });
      }
    }));
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/batch-1/books/book-1/${fixture.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixture.body)
    });
    assert.equal(response.status, fixture.status);
    if (fixture.status === 422) {
      assert.match((await response.json()).error, fixture.message);
      assert.equal(calls.some(call => call.method !== 'GET'), false, 'invalid effective selections cannot persist or dispatch work');
    } else {
      assert.deepEqual(calls, [
        { method: 'GET', pathname: '/api/batch-factory/v11/batches/batch-1', payload: undefined },
        { method: 'POST', pathname: '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/video', payload: fixture.body }
      ]);
    }
  });
}

for (const target of ['settings', 'books/book-1/override']) {
  for (const invalid of [true, false]) {
    test(`V12 ${target} ${invalid ? 'rejects wrong-kind model before persistence' : 'forwards sparse inheritance and valid model fields unchanged'}`, async t => {
      const calls = [];
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.username = 'alice'; req.auth = { account: { isOwner: true } }; next(); });
      app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
        goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
        configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [
          { id: 'text-1', kind: 'text', enabled: true, baseUrl: 'https://text.example/v1', modelId: 'text-provider', credential: 'test-key' }
        ] }),
        fetchImpl: async (url, init) => {
          calls.push({ method: init.method, pathname: new URL(url).pathname, payload: JSON.parse(init.body) });
          return new Response(JSON.stringify({ batch: { id: 'batch-1', revision: 8,
            settingsState: { patch: { aiPromptConfig: { assets: { presetId: 'preset-assets', body: 'server-only preset body' } } } } }
          }), { status: 200 });
        }
      }));
      const server = app.listen(0, '127.0.0.1');
      t.after(() => new Promise(resolve => server.close(resolve)));
      await new Promise(resolve => server.once('listening', resolve));
      const payload = { expectedRevision: 7, restoreKeys: ['videoModelId'], patch: invalid
        ? { videoModelId: 'text-1' }
        : target === 'settings' ? { textModelId: 'text-1', openingEnabled: false } : { openingEnabled: false } };
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/batch-1/${target}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      assert.equal(response.status, invalid ? 422 : 200);
      if (invalid) {
        assert.match((await response.json()).error, /视频模型不可用/);
        assert.deepEqual(calls, []);
      } else {
        assert.deepEqual(await response.json(), { batch: { id: 'batch-1', revision: 8,
          settingsState: { patch: { aiPromptConfig: { assets: { presetId: 'preset-assets' } } } } }
        });
        assert.equal(response.headers.get('x-batch-factory-version'), 'v12');
        assert.deepEqual(calls, [{ method: 'PUT', pathname: `/api/batch-factory/v11/batches/batch-1/${target}`, payload }]);
      }
    });
  }
}

test('V12 giant creation rejects an unavailable preset model before creating the batch', async t => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.username = 'alice'; req.auth = { account: { isOwner: true } }; next(); });
  app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
    goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
    configReader: () => ({ modelCatalogVersion: 1, modelCatalog: [] }),
    automationPresetStore: { get: async () => ({ id: 'preset-1', config: { textModelId: 'removed-text' } }) },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 201 }); }
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/intakes/intake-1/batches`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ giantAutomation: { presetId: 'preset-1' } })
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /文本模型不可用/);
  assert.deepEqual(calls, []);
});

test('applies the selected giant automation preset as initial unified settings without frozen metadata', () => {
  const preset = {
    id: 'preset-1', name: '全自动预设', version: 3,
    config: { textModelId: 'text-model-a', imageModelId: 'image-model-a', automationPresetSnapshot: { id: 'legacy' } }
  };
  const payload = buildGiantBatchCreatePayload({
    title: '巨量测试',
    giantAutomation: {
      presetId: 'preset-1',
      expectedPresetVersion: 3,
      runMode: 'full_submit',
      concurrency: 2,
      scheduledAt: '2026-10-02T12:00:00.000Z'
    }
  }, preset);

  assert.deepEqual(payload, {
    title: '巨量测试',
    initialBatchSettings: {
      textModelId: 'text-model-a', imageModelId: 'image-model-a'
    },
    giantAutomationPlan: {
      presetId: 'preset-1', runMode: 'full_submit', concurrency: 2,
      scheduledAt: '2026-10-02T12:00:00.000Z'
    }
  });
  payload.initialBatchSettings.textModelId = 'changed-after-creation';
  assert.equal(preset.config.textModelId, 'text-model-a');
  assert.deepEqual(preset.config.automationPresetSnapshot, { id: 'legacy' });
  assert.throws(() => buildGiantBatchCreatePayload({ giantAutomation: { presetId: 'preset-1', expectedPresetVersion: 2 } }, preset), /版本已变化/);
});

test('giant preset application keeps an immediate plan and rejects unavailable preset config', () => {
  const body = { title: '巨量测试', giantAutomation: {
    presetId: 'preset-1', expectedPresetVersion: 3, runMode: 'full_submit', concurrency: 2
  } };
  assert.deepEqual(buildGiantBatchCreatePayload(body, { id: 'preset-1', version: 3, config: { textModelId: 'text-preset' } }), {
    title: '巨量测试', initialBatchSettings: { textModelId: 'text-preset' },
    giantAutomationPlan: { presetId: 'preset-1', runMode: 'full_submit', concurrency: 2, scheduledAt: '' }
  });
  assert.throws(() => buildGiantBatchCreatePayload(body, null), /预设不存在/);
  assert.throws(() => buildGiantBatchCreatePayload(body, { id: 'preset-1', version: 3, config: { automationPresetSnapshot: { id: 'legacy' } } }), /没有可用配置/);
});

test('lists batch projects without serializing their full source and storyboard payloads', () => {
  const result = batchFactoryBatchListSummary({
    id: 'batch-1',
    title: '测试批量',
    projectCoverJobId: 'merge-1',
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
    revision: 3, bookCount: 1, coverMedia: { kind: 'image', url: '/api/batch-factory/v11/batches/batch-1/merge-cover/merge-1' },
    books: [{ id: 'book-1', bookId: '558154', title: '后来情深情亦浅', platform: '七猫' }]
  });
});

test('loads project cards from the lightweight summary index instead of full historical batches', async t => {
  const calls = [];
  const app = express();
  app.use((req, res, next) => { req.username = 'alice'; next(); });
  app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
    goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
    fetchImpl: async (url, init) => {
      calls.push({ pathname: new URL(url).pathname, method: init.method });
      return new Response(JSON.stringify({ batches: [{ id: 'batch-1', title: '测试批量', books: [] }] }), { status: 200 });
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/summary`);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ pathname: '/api/batch-factory/v11/batches/summary-index', method: 'GET' }]);
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

test('direct fetch derives and carries 121 category metadata into intake creation', async () => {
  const response = await fetchBatchFactoryOriginals({
    platform: '2', bookIds: ['7673480334440139800'], maxTxt: 2000
  }, async () => ({
    text: '第一章 正文', rawText: '第一章 正文',
    bookinfo: { work_title: '测试男频书', category: '男频-都市', genre: '都市' }
  }));

  assert.deepEqual(response.results[0].sourceMetadata, {
    bookName: '测试男频书', category: '男频-都市', genre: '都市', gender: '男频', genderSource: '121_category'
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
      sourceText: '抓回来的正文', sourceTitle: '白月光回港', expectedRevision: 7,
      sourceMetadata: {
        bookName: '白月光回港', contentCaptureCharacters: 4000, platformId: '15',
        sourceMode: 'manual_refetched', sourceFetchedAt: '2026-09-22T00:00:00.000Z',
        sourceFetchAttempts: 2, sourceCaptureCharacters: 4000, sourceBookId: '2084012035524801698', sourceBookTitle: '白月光回港',
        sourceOriginalRaw: '修改中&nbsp;\n。\n抓回来的正文'
      }
    }
  ]);
  assert.equal(result.book.sourceText, '抓回来的正文');
  await assert.rejects(() => refillMissingBatchFactoryBookSource({ book: { id: 'book-1', sourceText: '已存在正文' }, fetchDirectOriginal: async () => ({}) }), /已有正文/);
});

test('backfills only missing 121 metadata for an existing source without rewriting its text', async () => {
  const calls = [];
  const result = await backfillBatchFactoryBook121Metadata({
    book: {
      id: 'book-1', bookId: '7673480334440139800', platform: '2', sourceText: '已有且不可替换的正文', revision: 4,
      sourceMetadata: { gender: '', style: '现代甜文', sourceMode: 'manual_original' }
    },
    fetchDirectOriginal: async input => {
      calls.push({ type: 'fetch', input });
      return { bookinfo: { category: '男频-都市', genre: '都市' } };
    },
    saveMetadata: async input => { calls.push({ type: 'save', input }); return { book: { id: 'book-1', sourceMetadata: input.metadata } }; }
  });

  assert.deepEqual(calls, [
    { type: 'fetch', input: { bookId: '7673480334440139800', platformId: '2', maxTxt: 100 } },
    { type: 'save', input: {
      expectedRevision: 4,
      metadata: { gender: '男频', style: '现代甜文', sourceMode: 'manual_original', category: '男频-都市', genre: '都市', genderSource: '121_category' }
    } }
  ]);
  assert.equal(result.status, 'backfilled');
});

test('V12 bulk metadata backfill persists 121 category without replacing existing text', async t => {
  const calls = [];
  const book = { id: 'book-1', bookId: '7673480334440139800', platform: '2', sourceText: '已保存正文', revision: 5, sourceMetadata: { sourceMode: 'manual_original' } };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.username = 'alice'; req.auth = { account: { isOwner: false } }; next(); });
  app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
    goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
    workshopStoreFactory: () => ({
      getPlatforms: () => [{ id: '2', name: '番茄付费' }],
      fetchDirectOriginal: async input => { calls.push({ type: 'fetch', input }); return { bookinfo: { category: '男频-都市', genre: '都市' } }; }
    }),
    prepareBatchFactoryBookClassification: async () => ({ reused: false, classification: { gender: '男频', style: '都市' } }),
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      calls.push({ type: 'go', method: init.method, pathname, payload: init.body ? JSON.parse(init.body) : undefined });
      if (init.method === 'GET') return new Response(JSON.stringify({ batch: { id: 'batch-1', books: [book] } }), { status: 200 });
      if (init.method === 'PUT') return new Response(JSON.stringify({ book: { ...book, sourceMetadata: JSON.parse(init.body).metadata } }), { status: 200 });
      throw new Error(`unexpected ${init.method} ${pathname}`);
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/batch-1/backfill-121-metadata`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [{
    bookId: 'book-1',
    status: 'backfilled',
    classification: { status: 'classified', classification: { gender: '男频', style: '都市' }, reused: false }
  }]);
  assert.equal(calls.some(call => call.type === 'go' && call.method === 'PUT' && call.payload.metadata.gender === '男频'), true);
});

test('V12 bulk metadata backfill runs the existing AI fallback after 121 cannot decide gender', async t => {
  const calls = [];
  const book = { id: 'book-1', bookId: '7673480334440139800', platform: '2', sourceText: '已保存正文', revision: 5, sourceMetadata: { sourceMode: 'manual_original' } };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.username = 'alice'; req.auth = { account: { isOwner: false } }; next(); });
  app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
    goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: {},
    workshopStoreFactory: () => ({
      getPlatforms: () => [{ id: '2', name: '番茄付费' }],
      fetchDirectOriginal: async input => { calls.push({ type: 'fetch', input }); return { bookinfo: { category: '短篇', genre: '言情' } }; }
    }),
    prepareBatchFactoryBookClassification: async (_req, route) => {
      calls.push({ type: 'classify', route });
      return { reused: false, classification: { gender: '女频', style: '短篇言情' } };
    },
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      calls.push({ type: 'go', method: init.method, pathname, payload: init.body ? JSON.parse(init.body) : undefined });
      if (init.method === 'GET') return new Response(JSON.stringify({ batch: { id: 'batch-1', books: [book] } }), { status: 200 });
      if (init.method === 'PUT') return new Response(JSON.stringify({ book: { ...book, sourceMetadata: JSON.parse(init.body).metadata } }), { status: 200 });
      throw new Error(`unexpected ${init.method} ${pathname}`);
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/batch-1/backfill-121-metadata`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [{
    bookId: 'book-1',
    status: 'backfilled',
    classification: { status: 'classified', classification: { gender: '女频', style: '短篇言情' }, reused: false }
  }]);
  assert.deepEqual(calls.filter(call => call.type === 'classify'), [{ type: 'classify', route: { batchId: 'batch-1', bookId: 'book-1' } }]);
});

test('shared source refill keeps a giant placeholder on the bookstore path', async () => {
  const writes = [];
  const result = await refillSharedBatchFactoryBookSource({
    book: { id: 'book-1', bookId: '101', platform: '七猫', sourceText: '', revision: 4, sourceMetadata: { sourceMode: 'giant_material', contentPending: true } },
    platforms: [{ id: '3', name: '七猫' }],
    fetchDirectOriginal: async () => ({ text: '修改中\n书城正文', attempts: 2 }),
    captureSource: async payload => { writes.push(payload); return { ok: true }; }
  });

  assert.equal(result.fetched.length, 4);
  assert.equal(writes[0].sourceMetadata.originalReadVia, 'bookstore');
  assert.equal(writes[0].sourceMetadata.contentPending, false);
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

test('V12 reuses the supplied V11 automation controller instead of starting a second scheduler', () => {
  const legacy = express.Router();
  const automationController = { status: () => ({ state: 'idle' }) };
  legacy.automationController = automationController;

  const router = createBatchFactoryV12Router({ legacyRouter: legacy });

  assert.equal(router.automationController, automationController);
});

test('V12 deletion forwards the signed-in retention period to the Go deletion boundary', async t => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => { req.username = 'alice'; req.auth = { account: { isOwner: true } }; next(); });
  app.use('/api/batch-factory/v12', createBatchFactoryV12Router({
    goBaseUrl: 'http://go.local', bridgeSecret: 'secret', automationController: { removeBatch: async () => {} },
    configReader: () => ({ productionRetentionDays: 3 }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return new Response(null, { status: 204 });
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/batch-factory/v12/batches/batch-1`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  const target = new URL(calls[0].url);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(target.pathname, '/api/batch-factory/v11/batches/batch-1');
  assert.equal(target.searchParams.get('retentionDays'), '3');
});
