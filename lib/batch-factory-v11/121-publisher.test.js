const assert = require('node:assert/strict');
const test = require('node:test');
const { createBatchFactory121Publisher, contentToUpload, sourcePlatformID } = require('./121-publisher');

function withAiHeadClient(client) {
  return {
    ...client,
    action: async value => {
      if (value.path === '/tttadmin/api/music_put_url.php') {
        return { body: JSON.stringify({ success: true, data: { bucket_url: 'https://assets.121.test', files: [{ name: 'head.mp4', upload_url: 'https://upload.121.test/head.mp4', object_key: 'heads/head.mp4', headers: {} }] } }) };
      }
      return client.action(value);
    },
    uploadPresigned: client.uploadPresigned || (async () => ({ status: 200 }))
  };
}

const batch = {
  id: 'batch-1',
  settingsState: { patch: { publishSettings: { websiteProfileId: 'profile-1', platformId: '15', organization: '1', gender: '女', styleType: '现代虐文', materialReuse: true, horizontalFlip: true } } },
  books: [{ id: 'book-1', bookId: '2080310440299710279', title: '单书', platform: '15', sourceText: '原始正文', sourceMetadata: { gender: '女频', style: '现代虐文', classifyStatus: 'input_ready' }, settingsState: { patch: {} }, videos: [] }]
};

test('submits one V11 book as ID-named TXT plus its selected MP4', async () => {
  const actions = [];
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [{ id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-1.mp4', updatedAt: '2026-09-17T00:00:00Z' }] }),
    fetchMedia: async () => Buffer.from([0, 1, 2, 3]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => {
      actions.push(value);
      return { body: JSON.stringify(value.method === 'GET'
        ? { success: true, data: [] }
        : { success: true, result: { success: { count: 1, files: ['2080310440299710279.txt'] }, failed: { count: 0, files: [] } } }) };
    } }),
    now: () => new Date('2026-09-17T00:00:00Z')
  });

  const result = await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });

  assert.equal(result.status, 'accepted_pending');
  assert.equal(result.bookId, '2080310440299710279');
  assert.equal(actions[0].path, '/tttadmin/api/zbooklist_upload.php');
  assert.match(actions[0].body.toString('latin1'), /name="files\[\]"; filename="2080310440299710279\.txt"/);
  assert.match(actions[0].body.toString('utf8'), /name="organization"\r\n\r\n1\r\n/);
  assert.match(actions[0].body.toString('utf8'), /name="jieya_ai_head_video"\r\n\r\n\[{"name":"head\.mp4"/);
  assert.match(actions[0].body.toString('latin1'), /name="jieya_ai_head"\r\n\r\n3\r\n/);
  assert.match(actions[1].path, /zbooklist_get\.php\?bookid=2080310440299710279/);
  assert.equal(result.receipt.remote_record.status, '待确认');
});

test('publishes through the durable browser session without treating its key as a Cookie', async () => {
  const workerCalls = [];
  let directVerifyCalls = 0;
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [{ id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-1.mp4' }] }),
    fetchMedia: async () => Buffer.from([0, 1, 2, 3]),
    getSession: () => ({ cookie: 'opaque-session-index' }),
    workerAction: async (_owner, action, payload = {}) => {
      workerCalls.push({ action, payload });
      if (action === 'asset_presign') return { body: JSON.stringify({ success: true, data: { bucket_url: 'https://assets.121.test', files: [{ name: 'head.mp4', upload_url: 'https://upload.121.test/head.mp4', object_key: 'heads/head.mp4', headers: {} }] } }) };
      if (action === 'book_list') return { body: JSON.stringify({ success: true, data: [] }) };
      return { body: JSON.stringify({ success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) };
    },
    directClient: { verify: async () => { directVerifyCalls += 1; }, uploadPresigned: async () => ({ status: 200 }) }
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });

  assert.equal(directVerifyCalls, 0);
  assert.deepEqual(workerCalls.map(call => call.action), ['asset_presign', 'upload', 'book_list']);
  assert.equal(workerCalls[0].payload.contentType, 'application/json');
  assert.match(Buffer.from(workerCalls[1].payload.bodyBase64, 'base64').toString('utf8'), /name="files\[\]"/);
});

test('reserves enough time for a slow AI-head video upload instead of retaining the two-minute limit', async () => {
  const uploadCalls = [];
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [{ id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-1.mp4' }] }),
    fetchMedia: async () => Buffer.alloc(10 * 1024 * 1024, 1),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({
      verify: async () => ({ ok: true }),
      action: async value => ({ body: JSON.stringify(value.method === 'GET'
        ? { success: true, data: [] }
        : { success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) }),
      uploadPresigned: async value => { uploadCalls.push(value); return { status: 200 }; }
    })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });

  assert.equal(uploadCalls.length, 1);
  assert.ok(uploadCalls[0].timeoutMs >= 30 * 60 * 1000, `timeout=${uploadCalls[0].timeoutMs}`);
  assert.ok(uploadCalls[0].timeoutMs <= 60 * 60 * 1000);
});

test('rejects a V11 book before contacting 121 when organization is missing', async () => {
  let invoked = false;
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => ({ ...batch, settingsState: { patch: { publishSettings: { websiteProfileId: 'profile-1' } } } }),
    loadMergeStatus: async () => ({ jobs: [] }),
    fetchMedia: async () => Buffer.alloc(0),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => { invoked = true; }, action: async () => ({}) })
  });
  await assert.rejects(() => publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' }), /请选择组织归属/);
  assert.equal(invoked, false);
});

test('uses the current book source platform when an imported 121 profile omits it', async () => {
  const actions = [];
  const importedProfileBatch = {
    ...batch,
    settingsState: { patch: { publishSettings: {
      websiteProfileId: '121-371', organization: '1', gender: '女', styleType: '古风虐文',
      websiteProfiles: [{ id: '121-371', name: '4滚屏', platform_id: '', gender: '女', style: '古风虐文' }]
    } } },
    books: [{ ...batch.books[0], platform: '15' }]
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => importedProfileBatch,
    loadMergeStatus: async () => ({ jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/media/final.mp4' }] }),
    fetchMedia: async () => Buffer.from([1]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => {
      actions.push(value);
      return { body: JSON.stringify(value.method === 'GET' ? { success: true, data: [] } : { success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) };
    } })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.match(actions[0].body.toString('utf8'), /name="platform_id"\r\n\r\n15\r\n/);
});

test('maps verified giant-material source codes when legacy books have no platform id', () => {
  assert.equal(sourcePlatformID({ platform: 'ZH', sourceMetadata: { platformCode: 'ZH', platformId: '' } }), '15');
  assert.equal(sourcePlatformID({ platform: 'QM', sourceMetadata: { platformCode: 'QM', platformId: '' } }), '3');
  assert.equal(sourcePlatformID({ platform: 'CD', sourceMetadata: { platformCode: 'CD', platformId: '' } }), '2');
  assert.equal(sourcePlatformID({ platform: 'YG', sourceMetadata: { platformCode: 'YG', platformId: '' } }), '4');
  assert.equal(sourcePlatformID({ platform: '阳光', sourceMetadata: { platformId: '' } }), '4');
});

test('uses the selected single VIDEO when the book overrides its upload type', async () => {
  let mediaURL = '';
  const individualBatch = {
    ...batch,
    books: [{ ...batch.books[0], settingsState: { patch: { publishSettings: { uploadVideoType: 'individual' }, primaryUploadSource: { kind: 'video', videoId: 'video-2', taskId: 'task-2' } } } }]
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => individualBatch,
    loadMergeStatus: async () => ({ jobs: [] }),
    loadProductionStatus: async () => ({ jobs: [{ bookId: 'book-1', tasks: [{ id: 'task-1', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/one.mp4' }, { id: 'task-2', videoId: 'video-2', status: 'succeeded', mediaUrl: '/media/two.mp4' }] }] }),
    fetchMedia: async (_owner, url) => { mediaURL = url; return Buffer.from([1]); },
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) }) })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.equal(mediaURL, '/media/two.mp4');
});

test('uses the edited working front only when this book enables rewritten publishing', () => {
  const book = {
    sourceText: '第一行\n第二行\n第三行',
    workingFrontContent: '改第一行\n改第二行',
    sourceMetadata: { contentRangeLines: 2 }
  };
  assert.equal(contentToUpload(book, { publishRewriteEnabled: true }), '改第一行\n改第二行\n第三行');
  assert.equal(contentToUpload(book, { publishRewriteEnabled: false }), '第一行\n第二行\n第三行');
});

test('uses the effective batch and book rewrite decision for the uploaded TXT', async () => {
  const actions = [];
  const rewrittenBatch = {
    ...batch,
    settingsState: { patch: {
      ...batch.settingsState.patch,
      publishRewriteEnabled: true
    } },
    books: [{
      ...batch.books[0],
      sourceText: '原始第一行\n原始第二行',
      workingFrontContent: '改写第一行\n改写第二行',
      sourceMetadata: { gender: '女频', style: '现代虐文', classifyStatus: 'classified', contentRangeLines: 2 }
    }]
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => rewrittenBatch,
    loadMergeStatus: async () => ({ jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/media/final.mp4' }] }),
    fetchMedia: async () => Buffer.from([1]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => {
      actions.push(value);
      return { body: JSON.stringify(value.method === 'GET' ? { success: true, data: [] } : { success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) };
    } })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.match(actions[0].body.toString('utf8'), /改写第一行\r?\n改写第二行/);
});

test('uses a classified book rather than the batch default to build 121 fields', () => {
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [] }),
    fetchMedia: async () => Buffer.alloc(0),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({}) })
  });
  const fields = publisher.publishFields(
    { platformId: '2', gender: '男', styleType: '古风虐文', organization: '1' },
    {},
    { platform: '15', sourceMetadata: { gender: '女频', style: '现代虐文', classifyStatus: 'classified' } }
  );
  assert.equal(fields.platform_id, '15');
  assert.equal(fields.gender, '2');
  assert.equal(fields.style, '301');
});

test('blocks 121 submission when the current book has not been classified', () => {
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [] }),
    fetchMedia: async () => Buffer.alloc(0),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({}) })
  });
  assert.throws(
    () => publisher.publishFields({ platformId: '15', gender: '女', styleType: '现代虐文', organization: '1' }, {}, { platform: '15', sourceMetadata: { tags: '重生' } }),
    /当前小说尚未完成男女频和风格识别/
  );
});

test('blocks a 121 AI-head upload when the book has no decompression allocation', async () => {
  let contacted121 = false;
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => ({
      ...batch,
      settingsState: { patch: { publishSettings: { ...batch.settingsState.patch.publishSettings, advanced: { jieyaNum: 0 } } } }
    }),
    loadMergeStatus: async () => ({ jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/media/final.mp4' }] }),
    fetchMedia: async () => Buffer.from([1]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({
      verify: async () => { contacted121 = true; },
      action: async () => ({})
    })
  });

  await assert.rejects(() => publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' }), /请添加解压/);
  assert.equal(contacted121, false);
});

test('uses the configured decompression count while marking the attached video as a custom AI head', () => {
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [] }),
    fetchMedia: async () => Buffer.alloc(0),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({}) })
  });
  const fields = publisher.publishFields(
    { organization: '1', advanced: { jieyaNum: 2, jieyaAiHead: 0 } },
    {},
    { platform: '15', sourceMetadata: { gender: '女频', style: '现代虐文' } }
  );
  assert.equal(fields.jieya_num, '2');
  assert.equal(fields.jieya_ai_head, '3');
});

test('uploads every opening-variant merge output in a single TXT submission', async () => {
  const actions = [];
  const presignNames = [];
  const messages = [];
  let uploadCount = 0;
  const openingBatch = {
    ...batch,
    books: [{ ...batch.books[0], settingsState: { patch: { openingEnabled: true } } }]
  };
  const inner = withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => {
    actions.push(value);
    return { body: JSON.stringify(value.method === 'GET'
      ? { success: true, data: [] }
      : { success: true, result: { success: { count: 1, files: ['2080310440299710279.txt'] }, failed: { count: 0, files: [] } } }) };
  } });
  const baseAction = inner.action;
  const client = {
    ...inner,
    action: async value => {
      if (value.path === '/tttadmin/api/music_put_url.php') {
        presignNames.push(JSON.parse(value.body.toString('utf8')).files[0].name);
      }
      return baseAction(value);
    },
    uploadPresigned: async () => { uploadCount += 1; return { status: 200 }; }
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => openingBatch,
    loadMergeStatus: async () => ({ jobs: [
      { id: 'merge-0', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v0.mp4', openingVariantIndex: 0, updatedAt: '2026-09-17T00:00:00Z' },
      { id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v1.mp4', openingVariantIndex: 1, updatedAt: '2026-09-17T00:01:00Z' },
      { id: 'merge-2', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v2.mp4', openingVariantIndex: 2, updatedAt: '2026-09-17T00:02:00Z' }
    ] }),
    fetchMedia: async () => Buffer.from([0, 1, 2, 3]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    onProgress: async progress => { messages.push(progress.message); },
    directClient: client,
    now: () => new Date('2026-09-17T00:00:00Z')
  });

  const result = await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });

  assert.equal(uploadCount, 3);
  assert.deepEqual(presignNames, ['2080310440299710279.mp4', '2080310440299710279-v1.mp4', '2080310440299710279-v2.mp4']);
  const txtActions = actions.filter(action => action.path === '/tttadmin/api/zbooklist_upload.php');
  assert.equal(txtActions.length, 1);
  const headField = txtActions[0].body.toString('utf8').match(/name="jieya_ai_head_video"\r\n\r\n(\[.*?\])\r\n/s);
  assert.ok(headField, 'multipart should carry the jieya_ai_head_video field');
  assert.equal(JSON.parse(headField[1]).length, 3);
  assert.ok(messages.some(message => /换开头/.test(message) && /1\/3/.test(message)));
  assert.equal(result.aiHeadVideoFile, '2080310440299710279.mp4');
  assert.deepEqual(result.aiHeadVideoFiles, ['head.mp4', 'head.mp4', 'head.mp4']);
});

test('dedupes repeated succeeded jobs of the same opening variant by latest update', async () => {
  const fetched = [];
  const openingBatch = {
    ...batch,
    books: [{ ...batch.books[0], settingsState: { patch: { openingEnabled: true } } }]
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => openingBatch,
    loadMergeStatus: async () => ({ jobs: [
      { id: 'merge-0-old', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v0-old.mp4', openingVariantIndex: 0, updatedAt: '2026-09-17T00:00:00Z' },
      { id: 'merge-0-new', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v0-new.mp4', openingVariantIndex: 0, updatedAt: '2026-09-18T00:00:00Z' },
      { id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v1.mp4', openingVariantIndex: 1, updatedAt: '2026-09-17T00:01:00Z' }
    ] }),
    fetchMedia: async (_owner, url) => { fetched.push(url); return Buffer.from([1]); },
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) }) })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.deepEqual(fetched, ['/media/merge-v0-new.mp4', '/media/merge-v1.mp4']);
});

test('rejects the whole submission when one opening-variant upload fails', async () => {
  const actions = [];
  const openingBatch = {
    ...batch,
    books: [{ ...batch.books[0], settingsState: { patch: { openingEnabled: true } } }]
  };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => openingBatch,
    loadMergeStatus: async () => ({ jobs: [
      { id: 'merge-0', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v0.mp4', openingVariantIndex: 0 },
      { id: 'merge-1', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v1.mp4', openingVariantIndex: 1 },
      { id: 'merge-2', bookId: 'book-1', status: 'succeeded', outputUrl: '/media/merge-v2.mp4', openingVariantIndex: 2 }
    ] }),
    fetchMedia: async (_owner, url) => {
      if (String(url).includes('v1')) throw new Error('网络超时');
      return Buffer.from([1]);
    },
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => {
      actions.push(value);
      return { body: JSON.stringify({ success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) };
    } })
  });

  await assert.rejects(() => publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' }), /变体 1/);
  assert.equal(actions.filter(action => action.path === '/tttadmin/api/zbooklist_upload.php').length, 0);
});

test('keeps individual upload on a single VIDEO even when opening variants are enabled', async () => {
  let mediaURL = '';
  let uploadCount = 0;
  const individualOpeningBatch = {
    ...batch,
    books: [{ ...batch.books[0], settingsState: { patch: { openingEnabled: true, publishSettings: { uploadVideoType: 'individual' }, primaryUploadSource: { kind: 'video', videoId: 'video-2', taskId: 'task-2' } } } }]
  };
  const client = withAiHeadClient({ verify: async () => ({ ok: true }), action: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) }) });
  client.uploadPresigned = async () => { uploadCount += 1; return { status: 200 }; };
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => individualOpeningBatch,
    loadMergeStatus: async () => ({ jobs: [] }),
    loadProductionStatus: async () => ({ jobs: [{ bookId: 'book-1', tasks: [{ id: 'task-1', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/one.mp4' }, { id: 'task-2', videoId: 'video-2', status: 'succeeded', mediaUrl: '/media/two.mp4' }] }] }),
    fetchMedia: async (_owner, url) => { mediaURL = url; return Buffer.from([1]); },
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    directClient: client
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.equal(mediaURL, '/media/two.mp4');
  assert.equal(uploadCount, 1);
});

test('reports each actual 121 upload phase in order', async () => {
  const phases = [];
  const publisher = createBatchFactory121Publisher({
    loadBatch: async () => batch,
    loadMergeStatus: async () => ({ jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/media/final.mp4' }] }),
    fetchMedia: async () => Buffer.from([1]),
    getSession: () => ({ cookie: 'PHPSESSID=ready' }),
    onProgress: async progress => { phases.push(progress.phase); },
    directClient: withAiHeadClient({ verify: async () => ({ ok: true }), action: async value => ({ body: JSON.stringify(value.method === 'GET' ? { success: true, data: [] } : { success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) }) })
  });

  await publisher.submit('owner', { batchId: 'batch-1', bookId: 'book-1' });
  assert.deepEqual(phases, ['validation', 'session', 'ai_head', 'txt_submit', 'readback']);
});
