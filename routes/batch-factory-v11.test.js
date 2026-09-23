const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichBatchFactorySystemPresetConfig,
  resolveDerivedOpeningPrompt,
  refreshBatchFactoryPresetSnapshot,
  presetDrivenExecutionPath,
  smartUnifiedSelected,
  directorVisualBaselineRequired,
  styleSystemBookPath,
  analyzeBatchFactorySmartUnifiedStyle,
  needsPersonalConfigSync,
  needsH3ConfigSync,
  redactBatchFactorySystemPromptBodies,
  upstreamErrorMessage,
  batchFactory121PublishPath,
  batchFactory121OrganizationsPath,
  organizationOptions,
  automationPublishSettings,
  submitBatchFactoryBookTo121,
  classifyBatchFactoryBookFor121,
  parseBatchBookClassification,
  ensureBatchFactory121ResubmissionAllowed,
  persisted121PublicationMetadata,
  v11JSONRequest,
  safeAutomationStatus,
  splitVideoPresetBody
} = require('./batch-factory-v11');

test('style.system runs during asset extraction but never when a director stage is requested', () => {
  const assetPath = '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/assets';
  const directorPath = '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/director';
  assert.deepEqual(styleSystemBookPath(assetPath), { batchId: 'batch-1', bookId: 'book-1' });
  assert.equal(styleSystemBookPath(directorPath), null);
});

test('automation status degrades to a readable idle state when its controller throws', () => {
  const result = safeAutomationStatus({
    status() { throw new Error('legacy automation state is unreadable'); }
  }, { owner: 'alice', batchId: 'batch-1' });

  assert.equal(result.state, 'unavailable');
  assert.equal(result.diagnosticCode, 'AUTOMATION_STATUS_UNAVAILABLE');
  assert.deepEqual(result.counts, { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 });
});

test('splits one H3 video preset into director rules and its final prompt template', () => {
  const result = splitVideoPresetBody('原版导演规则\ncharacter_slot_ids\n【批量工厂最终 Prompt 模板】\n{{storyboard}}');
  assert.equal(result.directorRules, '原版导演规则\ncharacter_slot_ids');
  assert.equal(result.finalTemplate, '{{storyboard}}');
});

test('identifies the explicit per-book 121 publish action without matching other V11 routes', () => {
  assert.deepEqual(
    batchFactory121PublishPath('/api/batch-factory/v11/batches/batch-1/books/book-1/publish-121'),
    { batchId: 'batch-1', bookId: 'book-1' }
  );
  assert.equal(batchFactory121PublishPath('/api/batch-factory/v11/batches/batch-1/status'), null);
  assert.equal(batchFactory121OrganizationsPath('/api/batch-factory/v11/publish-121/organizations'), true);
  assert.equal(batchFactory121OrganizationsPath('/publish-121/organizations'), true);
});

test('normalizes only usable 121 organization options', () => {
  assert.deepEqual(organizationOptions({ success: true, data: [
    { id: 1, name: '博量', level: 1 },
    { organization_id: 3, organization_name: '璇奕组织', level_name: '层2' },
    { id: '', name: '无效' }
  ] }), [
    { id: '1', name: '博量', level: '1' },
    { id: '3', name: '璇奕组织', level: '层2' }
  ]);
});

test('automation publish settings keep an explicit frozen blank instead of falling back to live batch settings', () => {
  const batch = { settingsState: { patch: { publishSettings: { organization: 'live-org', category: 'LIVE' } } } };
  const book = { sourceText: '完整视频原文', settingsState: { patch: {} } };
  assert.deepEqual(automationPublishSettings(batch, book, { publishSettings: { organization: '', category: 'FROZEN' } }), { organization: '', category: 'FROZEN' });
});

test('blocks an already uploaded book until the caller explicitly requests a reupload', () => {
  const book = { sourceMetadata: { websiteSubmitStatus: 'uploaded' } };
  assert.throws(() => ensureBatchFactory121ResubmissionAllowed(book, {}), /已上传，请使用重新上传/);
  assert.doesNotThrow(() => ensureBatchFactory121ResubmissionAllowed(book, { reupload: true }));
});

test('keeps append-only 121 submission history and the latest readback progress', () => {
  const metadata = persisted121PublicationMetadata({
    websiteSubmitHistory: [{ submittedAt: '2026-09-16T00:00:00.000Z', status: 'confirmed' }]
  }, {
    status: 'accepted_pending',
    uploadedAt: '2026-09-17T00:00:00.000Z',
    sourceTextFile: '208.txt',
    aiHeadVideoFile: '208.mp4',
    receipt: { verified: false, remote_record: { found: false, detail: '等待 121 回读' } }
  });
  assert.equal(metadata.websiteSubmitHistory.length, 2);
  assert.deepEqual(metadata.websiteSubmitProgress, {
    phase: 'readback', status: 'waiting', message: '等待 121 回读', updatedAt: '2026-09-17T00:00:00.000Z'
  });
});

test('submits only the requested book to the direct 121 publisher', async () => {
  const requests = [];
  const actions = [];
  const batch = {
    id: 'batch-1',
    settingsState: { patch: { publishSettings: { websiteProfileId: 'profile-1', platformId: '15', organization: '1', gender: '女', styleType: '现代虐文' } } },
    books: [{ id: 'book-1', bookId: '2080310440299710279', platform: '15', sourceText: '正文', sourceMetadata: { sourceMode: 'manual_original', gender: '女频', style: '现代虐文', classifyStatus: 'classified' }, revision: 1, settingsState: { patch: {} } }]
  };
  const req = {
    username: 'alice',
    auth: { account: { isOwner: false } },
    app: { locals: { novelFetchStore: { getSession: () => ({ cookie: 'PHPSESSID=ready' }) } } }
  };
  const responseFor = value => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
    arrayBuffer: async () => Buffer.from([0, 1, 2, 3]).buffer
  });
  const result = await submitBatchFactoryBookTo121(req, { batchId: 'batch-1', bookId: 'book-1' }, {
    goBaseUrl: 'http://v11.test',
    bridgeSecret: 'bridge',
    directClient: {
      verify: async () => ({ ok: true }),
      action: async request => {
        if (request.path === '/tttadmin/api/music_put_url.php') {
          return { body: JSON.stringify({ success: true, data: { bucket_url: 'https://assets.121.test', files: [{ name: 'head.mp4', upload_url: 'https://upload.121.test/head.mp4', object_key: 'heads/head.mp4', headers: {} }] } }) };
        }
        actions.push(request);
        return { body: JSON.stringify(request.method === 'GET' ? { success: true, data: [] } : { success: true, result: { success: { count: 1 }, failed: { count: 0 } } }) };
      },
      uploadPresigned: async () => ({ status: 200 })
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/batches/batch-1')) return responseFor({ batch });
      if (url.endsWith('/batches/batch-1/books/book-1/metadata') && options.method === 'PUT') return responseFor({ book: { ...batch.books[0], revision: 2 } });
      if (url.endsWith('/batches/batch-1/merge-status')) return responseFor({ jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/api/batch-factory/v11/media/merge-1.mp4' }] });
      if (url.endsWith('/api/batch-factory/v11/media/merge-1.mp4')) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([0, 1, 2, 3]).buffer };
      throw new Error(`unexpected URL ${url}`);
    }
  });

  assert.equal(result.status, 'accepted_pending');
  assert.equal(actions.length, 2);
  assert.equal(actions[0].method, 'POST');
  assert.match(actions[0].body.toString('latin1'), /filename="2080310440299710279\.txt"/);
  assert.match(actions[0].body.toString('utf8'), /name="jieya_ai_head_video"\r\n\r\n\[{"name":"head\.mp4"/);
  assert.equal(requests.some(item => item.url.endsWith('/batches/batch-1/status')), false);
  const metadataWrite = requests.filter(item => item.url.endsWith('/batches/batch-1/books/book-1/metadata')).at(-1);
  assert.ok(metadataWrite, 'the 121 receipt must be persisted to the current book');
  const metadataPayload = JSON.parse(metadataWrite.options.body);
  assert.equal(metadataPayload.expectedRevision, 1);
  assert.equal(metadataPayload.metadata.websiteSubmitStatus, 'submitted');
  assert.equal(metadataPayload.metadata.websiteSubmitProgress.phase, 'readback');
  assert.equal(metadataPayload.metadata.websiteSubmitProgress.status, 'waiting');
  assert.equal(metadataPayload.metadata.websiteSubmitHistory.length, 1);
  const progressPhases = requests
    .filter(item => item.url.endsWith('/batches/batch-1/books/book-1/metadata') && item.options.method === 'PUT')
    .map(item => JSON.parse(item.options.body).metadata.websiteSubmitProgress?.phase)
    .filter(Boolean);
  assert.deepEqual(progressPhases, ['classification', 'validation', 'session', 'ai_head', 'txt_submit', 'readback', 'readback']);
});

test('classifies missing per-book publish metadata and persists it before any 121 submission', async () => {
  const calls = [];
  const book = { id: 'book-1', title: '女主重生复仇', platform: '15', sourceText: '沈薇重生回到离婚前，决定查清真相。', sourceMetadata: { tags: '' }, revision: 7 };
  const result = await classifyBatchFactoryBookFor121({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'bridge', now: () => Date.parse('2026-09-17T01:02:03.000Z'),
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'gpt-5.4', displayName: 'GPT-5.4' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'GET') return new Response(JSON.stringify({ batch: { id: 'batch-1', books: [book] } }), { status: 200 });
      if (url === 'http://text.local/v1/chat/completions') {
        return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"gender":"女频","style":"现代虐文","tags":["重生","复仇"],"reason":"现代女性复仇线"}\n```' } }] }), { status: 200 });
      }
      if (init.method === 'PUT') return new Response(JSON.stringify({ book: { ...book, revision: 8 } }), { status: 200 });
      throw new Error(`unexpected request: ${init.method} ${url}`);
    }
  });
  assert.equal(result.reused, false);
  assert.deepEqual(result.classification, { gender: '女频', style: '现代虐文', tags: '重生、复仇', reason: '现代女性复仇线' });
  const save = calls.find(call => call.init.method === 'PUT');
  assert.ok(save, 'the classification must persist before upload');
  const payload = JSON.parse(save.init.body);
  assert.deepEqual(payload, {
    metadata: { gender: '女频', style: '现代虐文', tags: '重生、复仇', classifyStatus: 'classified', classifyReason: '现代女性复仇线', classifyModel: 'GPT-5.4', classifyAt: '2026-09-17T01:02:03.000Z' },
    expectedRevision: 7
  });
  assert.equal(calls.filter(call => call.url === 'http://text.local/v1/chat/completions').length, 1);
});

test('rejects a model classification that is not a valid 121 gender and style', () => {
  assert.throws(() => parseBatchBookClassification('{"gender":"未知","style":"仙侠"}'), /必须返回男女频/);
});

test('uses the runtime fetch when V11 helper receives no injected fetch', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const result = await v11JSONRequest({
      username: 'alice',
      isOwner: false,
      method: 'GET',
      pathname: '/api/batch-factory/v11/batches/batch-1',
      goBaseUrl: 'http://v11.test',
      bridgeSecret: 'bridge'
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://v11.test/api/batch-factory/v11/batches/batch-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('asset preparation analyses style.system even when smart-unified display is off', async () => {
  const calls = [];
  const fields = {
    imageMedium: '真人数字电影短剧', captureProcess: '数字电影摄影', grainTexture: '细腻胶片颗粒',
    filterColorSystem: '低饱和冷暖对比', lensLanguage: '克制叙事镜头语言', opticalCharacter: '柔和高光',
    contrast: '中等对比', saturation: '低饱和', lightingHierarchy: '层次化侧逆光',
    narrativeComposition: '人物关系优先', atmosphere: '克制悬疑'
  };
  const style = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'GET') {
        return new Response(JSON.stringify({
          batch: {
            id: 'batch-1',
            settingsState: { patch: { aiPromptConfig: { constraints: { selections: [] } } } },
            books: [{
              id: 'book-1',
              sourceText: '完整原文',
              settingsState: { patch: { aiPromptConfig: { constraints: { enabled: false } } } },
              assetRecords: []
            }]
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) } }] }), { status: 200 });
    }
  });
  assert.equal(calls.length, 2);
  assert.match(style, /影像媒介：真人数字电影短剧/);
});

test('asset preparation accepts style.system JSON wrapped in a model explanation', async () => {
  const fields = {
    final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
    negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
  };
  const style = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: {} }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: `分析如下：\n\n\`\`\`json\n${JSON.stringify(fields)}\n\`\`\`` } }] }), { status: 200 });
    }
  });
  assert.match(style, /现代都市短剧；高级电影感；当代都市/);
});

test('asset preparation accepts a bare style.system object surrounded by model prose', async () => {
  const fields = {
    final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
    negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
  };
  const style = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: {} }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: `以下是分析结果：\n${JSON.stringify(fields)}\n请按上述字段使用。` } }] }), { status: 200 });
    }
  });
  assert.match(style, /现代都市短剧；高级电影感；当代都市/);
});

test('asset preparation reads style.system text from OpenAI-compatible content parts', async () => {
  const fields = {
    final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
    negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
  };
  const style = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: {} }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(fields) }] } }] }), { status: 200 });
    }
  });
  assert.match(style, /现代都市短剧；高级电影感；当代都市/);
});

test('asset preparation freezes the style.system result on the book for later director use', async () => {
  const calls = [];
  const fields = {
    final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
    negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
  };
  await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret', persist: true,
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: {} }, books: [{ id: 'book-1', revision: 7, sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      if (url === 'http://text.local/v1/chat/completions') return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) } }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.method, 'PUT');
  const frozen = JSON.parse(calls[2].init.body);
  assert.equal(frozen.expectedRevision, 7);
  assert.match(frozen.patch.h3StyleAnalysis, /现代都市短剧/);
  assert.match(frozen.patch.h3StyleSourceHash, /^[a-f0-9]{64}$/);
});

test('H3 obtains the hidden visual baseline even when smart-unified display is off', async () => {
  const calls = [];
  const fields = {
    imageMedium: '真人数字电影短剧', captureProcess: '数字电影摄影', grainTexture: '细腻胶片颗粒',
    filterColorSystem: '低饱和冷暖对比', lensLanguage: '克制叙事镜头语言', opticalCharacter: '柔和高光',
    contrast: '中等对比', saturation: '低饱和', lightingHierarchy: '层次化侧逆光',
    narrativeComposition: '人物关系优先', atmosphere: '克制悬疑'
  };
  const style = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: { aiPromptConfig: { video: { enabled: true, presetKey: 'h3-video-normal' } } } }, books: [{ id: 'book-1', sourceText: '完整原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) } }] }), { status: 200 });
    }
  });
  assert.match(style, /影像媒介：真人数字电影短剧/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'POST');
});

test('H3 style.system uses the frozen smart-unified preset and returns a traceable analysis', async () => {
  const calls = [];
  const styleSystem = 'CUSTOM STYLE.SYSTEM RULE: return final_genre, trailer_style and story_era as JSON.';
  const result = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    presetStore: { getPublished: id => id === 'script-constraint-prefix-smart-unified' ? { id, name: '智能统一', version: 7, body: styleSystem } : null, listAll: () => [] },
    fetchImpl: async (_url, init = {}) => {
      calls.push(init);
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: { aiPromptConfig: { video: { enabled: true, presetId: 'batch-video-h3-director' } } } }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
        negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
      }) } }] }), { status: 200 });
    }
  });

  assert.equal(JSON.parse(calls[1].body).messages[0].content, styleSystem);
  assert.deepEqual(JSON.parse(result), {
    schema_version: 'h3-style-system/v1',
    prompt: '现代都市短剧；高级电影感；当代都市。',
    fields: {
      final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
      negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
    },
    preset: { id: 'script-constraint-prefix-smart-unified', name: '智能统一', version: 7 }
  });
});

test('H3 style.system accepts a provider envelope that wraps its fields', async () => {
  const result = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: { aiPromptConfig: { video: { enabled: true, presetId: 'batch-video-h3-director' } } } }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        schema_version: 'h3-style-system/v1',
        prompt: '模型展示文案不作为权威来源',
        fields: {
          final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
          negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
        }
      }) } }] }), { status: 200 });
    }
  });

  const parsed = JSON.parse(result);
  assert.equal(parsed.fields.final_genre, '现代都市短剧');
  assert.equal(parsed.prompt, '现代都市短剧；高级电影感；当代都市。');
});

test('H3 style.system accepts an H3 result nested below a provider result envelope', async () => {
  const result = await analyzeBatchFactorySmartUnifiedStyle({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
    textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'text-model' },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') return new Response(JSON.stringify({
        batch: { id: 'batch-1', settingsState: { patch: { aiPromptConfig: { video: { enabled: true, presetId: 'batch-video-h3-director' } } } }, books: [{ id: 'book-1', sourceText: '完整视频原文', settingsState: { patch: {} }, assetRecords: [] }] }
      }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ result: { fields: {
        final_genre: '现代都市短剧', genre: '现代都市短剧', trailer_style: '高级电影感', story_era: '当代都市',
        negative_prompt: '无畸形', picture_limit_prompt: '无字幕', quality_constraint_prompt: '画面稳定'
      } } }) } }] }), { status: 200 });
    }
  });

  assert.equal(JSON.parse(result).fields.final_genre, '现代都市短剧');
});

test('returns a smart-unified provider credential failure instead of calling the Go service unavailable', () => {
  const error = Object.assign(new Error('智能统一视觉分析模型“gemini-3.5-flash-maxthinking”请求失败：当前无可用凭证'), {
    code: 'SMART_UNIFIED_PROVIDER_FAILED'
  });
  assert.equal(upstreamErrorMessage(error, 502), '智能统一视觉分析模型“gemini-3.5-flash-maxthinking”请求失败：当前无可用凭证');
});

test('identifies the selected text model when smart-unified analysis rejects its credential', async () => {
  await assert.rejects(
    analyzeBatchFactorySmartUnifiedStyle({
      username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret',
      textProvider: { endpoint: 'http://text.local/v1/chat/completions', apiKey: 'key', model: 'gpt-5.4', displayName: 'GPT-5.4' },
      fetchImpl: async (_url, init = {}) => {
        if (init.method === 'GET') return new Response(JSON.stringify({ batch: { id: 'batch-1', settingsState: { patch: { aiPromptConfig: { constraints: { selections: [{ presetId: 'script-constraint-prefix-smart-unified', constraintCategory: 'prefix' }] } } } }, books: [{ id: 'book-1', sourceText: '完整原文', assetRecords: [] }] } }), { status: 200 });
        return new Response(JSON.stringify({ error: { message: '当前无可用凭证' } }), { status: 401 });
      }
    }),
    /智能统一视觉分析模型“GPT-5\.4”请求失败：当前无可用凭证/
  );
});

function makePreset(id, module, kind, protocolLock, body) {
  return { id, module, kind, name: id, version: 3, protocolLock, body };
}

function presetStore() {
  const records = new Map([
    ['script-extract', makePreset('script-extract', 'script', 'base', { format: 'extract', slot: 'script.extract' }, '提取人物与场景')],
    ['script-extract-assets', makePreset('script-extract-assets', 'script', 'base', { format: 'extract', slot: 'script.asset-extraction' }, '提取人物、场景与关键道具')],
    ['script-extract-assets-female', makePreset('script-extract-assets-female', 'script', 'base', { format: 'extract', slot: 'script.asset-extraction' }, '女频人物、场景与关键道具')],
    ['script-constraint-wrapper', makePreset('script-constraint-wrapper', 'script', 'base', { slot: 'script.constraint.wrapper' }, '约束总规则')],
    ['batch-hook-adaptation', makePreset('batch-hook-adaptation', 'batch-factory', 'base', { slot: 'batch.hook-adaptation' }, '爆款开头规则')],
    ['batch-original-director', makePreset('batch-original-director', 'batch-factory', 'base', { slot: 'batch.original-director' }, '原文导演规则')],
    ['batch-viral-director', makePreset('batch-viral-director', 'batch-factory', 'base', { slot: 'batch.viral-director' }, '爆款导演规则')],
    ['batch-video-meta', makePreset('batch-video-meta', 'batch-factory', 'base', { slot: 'batch.video-meta' }, '完整分镜元提示词')],
    ['batch-video-custom', makePreset('batch-video-custom', 'batch-factory', 'base', { slot: 'batch.video-meta' }, '自定义视频提示词')],
    ['script-segmented', makePreset('script-segmented', 'script', 'base', { slot: 'script.segmented' }, '分段开头规则')],
    ['script-general', makePreset('script-general', 'script', 'base', { slot: 'script.general' }, '通用规则')],
    ['script-character-focus', makePreset('script-character-focus', 'script', 'base', { slot: 'script.character-focus' }, '星标人物聚焦规则')],
    ['script-audio-match', makePreset('script-audio-match', 'script', 'base', { slot: 'script.audio-match' }, '匹配音频规则')],
    ['script-card-protocol', makePreset('script-card-protocol', 'script', 'base', { slot: 'script.card.protocol' }, '统一外层分镜卡片协议')],
    ['script-format-shotlist', makePreset('script-format-shotlist', 'script', 'base', { slot: 'script.format.shotlist' }, '分镜模式规则')],
    ['batch-prefix-modern-conflict', makePreset('batch-prefix-modern-conflict', 'batch-factory', 'base', { slot: 'batch.prefix', key: 'modern_conflict', format: 'video-prefix' }, '现代冲突前缀')],
    ['batch-character-meta', makePreset('batch-character-meta', 'batch-factory', 'base', { slot: 'batch.character-meta' }, '只生成人物提示词')],
    ['batch-scene-meta', makePreset('batch-scene-meta', 'batch-factory', 'base', { slot: 'batch.scene-meta' }, '只生成场景提示词')],
    ['script-constraint-quality-4k', makePreset('script-constraint-quality-4k', 'script', 'addon', { format: 'constraint', slot: 'script.constraint.quality' }, '4K 约束')],
    ['script-constraint-prefix-smart-unified', makePreset('script-constraint-prefix-smart-unified', 'script', 'addon', { format: 'constraint', slot: 'script.constraint.prefix' }, '智能统一元提示词')]
  ]);
  return { getPublished: id => records.get(id) || null, listAll: () => [] };
}

test('enrichment rejects a non-script extraction preset for the unified asset rule', () => {
  const input = { patch: { aiPromptConfig: { assets: { extraction: { presetId: 'batch-scene-meta' } } } } };
  assert.throws(
    () => enrichBatchFactorySystemPresetConfig(input, presetStore()),
    /人物场景道具提示词/
  );
});

test('derivative-opening selection accepts only its three published prompt slots', () => {
  const selected = resolveDerivedOpeningPrompt('batch-viral-director', presetStore());
  assert.equal(selected.presetId, 'batch-viral-director');
  assert.equal(selected.body, '爆款导演规则');
  assert.throws(() => resolveDerivedOpeningPrompt('batch-video-meta', presetStore()), /衍生开篇/);
});

test('final-prompt previews never refresh or write preset snapshots', () => {
  const result = presetDrivenExecutionPath(
    { method: 'GET' },
    '/api/batch-factory/v11/batches/batch-1/books/book-1/videos/video-1/final-prompt'
  );
  assert.equal(result, null);
});

test('batch status reads never require a personal video provider sync', () => {
  const request = { method: 'GET' };
  const statusPath = '/api/batch-factory/v11/batches/batch-1/status';
  assert.equal(needsPersonalConfigSync(request, statusPath), false);
  assert.equal(needsH3ConfigSync(request, statusPath), false);
});

test('single-book VIDEO stages synchronize the selected provider before submitting work', () => {
  const request = { method: 'POST' };
  const stagePath = '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/video';
  assert.equal(needsPersonalConfigSync(request, stagePath), true);
  assert.equal(needsH3ConfigSync(request, stagePath), true);
});

test('retrying a non-video stage never requires a video provider sync', () => {
  const request = { method: 'POST' };
  const retryPath = '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/retry';
  assert.equal(needsPersonalConfigSync(request, retryPath), false);
  assert.equal(needsH3ConfigSync(request, retryPath), false);
});

test('enrichment snapshots the only combined script extraction preset and strips browser supplied bodies', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        assets: {
          extraction: { presetId: 'script-extract-assets', body: '浏览器伪造正文', prompt: '旧正文' }
        }
      }
    }
  }, presetStore());
  const { extraction, character } = enriched.patch.aiPromptConfig.assets;
  assert.equal(extraction.body, '提取人物、场景与关键道具');
  assert.equal(extraction.prompt, undefined);
  assert.equal(character, undefined);
  assert.equal(redactBatchFactorySystemPromptBodies(enriched).patch.aiPromptConfig.assets.extraction.body, undefined);
});

test('enrichment rejects the character-and-scene-only script extractor for Batch Factory assets', () => {
  assert.throws(
    () => enrichBatchFactorySystemPresetConfig({ patch: { aiPromptConfig: { assets: { extraction: { presetId: 'script-extract' } } } } }, presetStore()),
    /人物场景道具提示词/
  );
});

test('enrichment defaults old batches to the combined script asset extraction preset', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: { aiPromptConfig: { assets: { enabled: true } } }
  }, presetStore());
  assert.deepEqual(enriched.patch.aiPromptConfig.assets.extraction, {
    presetId: 'script-extract-assets',
    presetName: 'script-extract-assets',
    presetSlot: 'script.asset-extraction',
    presetVersion: 3,
    body: '提取人物、场景与关键道具'
  });
});

test('migrates a legacy single-book smart-unified prefix into the typed constraint selection', () => {
  const legacyBook = { settingsState: { patch: { aiPromptConfig: { constraints: { enabled: true, prefix: { enabled: true, presetId: 'script-constraint-prefix-smart-unified' } } } } } };
  assert.equal(smartUnifiedSelected({ settingsState: { patch: {} } }, legacyBook), true);
  const enriched = enrichBatchFactorySystemPresetConfig({ patch: legacyBook.settingsState.patch }, presetStore());
  const constraints = enriched.patch.aiPromptConfig.constraints;
  assert.equal(constraints.prefix, undefined);
  assert.deepEqual(constraints.selections.map(item => [item.presetId, item.constraintCategory]), [['script-constraint-prefix-smart-unified', 'prefix']]);
  assert.equal(constraints.selections[0].body, '智能统一元提示词');
});

test('H3 runs visual-baseline analysis without enabling smart-unified display', () => {
  const batch = { settingsState: { patch: { aiPromptConfig: {
    video: { enabled: true, presetId: 'batch-video-h3-director', presetKey: 'h3-video-normal' }
  } } } };
  const book = { sourceText: '完整视频原文', settingsState: { patch: {} } };
  assert.equal(smartUnifiedSelected(batch, book), false);
	assert.equal(directorVisualBaselineRequired(batch, book), true);
});

test('enrichment snapshots the ordinary public script composition for every V11 book', () => {
  const records = new Map([
    ['script-segmented', makePreset('script-segmented', 'script', 'base', { slot: 'script.segmented' }, 'SEGMENTED {duration}')],
    ['script-format-shotlist', makePreset('script-format-shotlist', 'script', 'base', { slot: 'script.format.shotlist' }, 'SHOTLIST {duration}')],
    ['script-general', makePreset('script-general', 'script', 'base', { slot: 'script.general' }, 'GENERAL {duration}')],
    ['script-character-focus', makePreset('script-character-focus', 'script', 'base', { slot: 'script.character-focus' }, 'FOCUS {focusCharacters}/{focusCount}')],
    ['script-audio-match', makePreset('script-audio-match', 'script', 'base', { slot: 'script.audio-match' }, 'AUDIO {audioDurationSec}/{unitMaxSec}')],
    ['script-card-protocol', makePreset('script-card-protocol', 'script', 'base', { slot: 'script.card.protocol' }, 'CARD {duration}')],
    ['script-constraint-wrapper', makePreset('script-constraint-wrapper', 'script', 'base', { slot: 'script.constraint.wrapper' }, 'WRAPPER {duration}')]
  ]);
  const store = { getPublished: id => records.get(id) || null, listAll: () => [...records.values()] };
  const enriched = enrichBatchFactorySystemPresetConfig({ patch: { aiPromptConfig: {} } }, store);
  const composition = enriched.patch.aiPromptConfig.scriptComposition;
  assert.deepEqual(
    Object.fromEntries(Object.entries(composition).map(([key, value]) => [key, value.presetId])),
    {
      segmented: 'script-segmented', shotlist: 'script-format-shotlist', general: 'script-general',
      characterFocus: 'script-character-focus', audioMatch: 'script-audio-match',
      cardProtocol: 'script-card-protocol', constraintWrapper: 'script-constraint-wrapper'
    }
  );
  assert.equal(composition.segmented.body, 'SEGMENTED {duration}');
  assert.equal(composition.cardProtocol.body, 'CARD {duration}');
});

test('enrichment resolves script constraints as typed selections', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        constraints: { enabled: true, selections: [{ presetId: 'script-constraint-quality-4k' }] }
      }
    }
  }, presetStore());
  assert.deepEqual(enriched.patch.aiPromptConfig.constraints.selections[0], {
    presetId: 'script-constraint-quality-4k',
    presetName: 'script-constraint-quality-4k',
    presetSlot: 'script.constraint.quality',
    presetVersion: 3,
    constraintCategory: 'quality',
    body: '4K 约束'
  });
});

test('enrichment keeps the selected published video prompt as one option in the Batch Factory video prompt selector', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        video: { enabled: true, presetId: 'batch-video-custom', body: '浏览器伪造的旧视频规则' }
      }
    }
  }, presetStore());
  const video = enriched.patch.aiPromptConfig.video;
  assert.equal(video.presetId, 'batch-video-custom');
  assert.equal(video.presetName, 'batch-video-custom');
  assert.equal(video.body, '自定义视频提示词');
  assert.equal(video.sourcePresets, undefined);
});

test('enrichment keeps the selected character renderer while dropping retired wrapper and prefix settings', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        assets: { extraction: { presetId: 'script-extract-assets-female' }, character: { presetId: 'batch-character-meta' } },
        constraints: { wrapper: { presetId: 'script-constraint-wrapper' } },
        hook: { presetId: 'batch-hook-adaptation' },
        originalDirector: { presetId: 'batch-original-director' },
        viralDirector: { presetId: 'batch-viral-director' },
        prefix: { presetId: 'batch-prefix-modern-conflict' }
      }
    }
  }, presetStore());
  const config = enriched.patch.aiPromptConfig;
  assert.equal(config.assets.extraction.body, '女频人物、场景与关键道具');
	assert.equal(config.assets.character.body, '只生成人物提示词');
  assert.equal(config.constraints.wrapper, undefined);
  assert.equal(config.hook.body, '爆款开头规则');
  assert.equal(config.originalDirector.body, '原文导演规则');
  assert.equal(config.viralDirector.body, '爆款导演规则');
  assert.equal(config.prefix, undefined);
});

test('execution refreshes the selected preset snapshot to the latest published name, version and body', async () => {
  const calls = [];
  const store = presetStore();
  const latest = store.getPublished('script-extract-assets');
  latest.name = '统一资产提取（最新）';
  latest.version = 4;
  latest.body = '最新资产提取规则';
  const result = await refreshBatchFactoryPresetSnapshot({
    username: 'alice', isOwner: false, batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret', presetStore: store,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const batch = { id: 'batch-1', revision: 7, settingsState: { patch: { aiPromptConfig: { assets: { extraction: { presetId: 'script-extract-assets', presetName: '旧名称', presetVersion: 3, body: '旧正文' } } } } }, books: [{ id: 'book-1', revision: 5, settingsState: { patch: {} } }] };
      return new Response(JSON.stringify({ batch }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(result.batchRefreshed, true);
  assert.equal(calls.length, 2);
  const saved = JSON.parse(calls[1].init.body);
  assert.equal(saved.patch.aiPromptConfig.assets.extraction.presetName, '统一资产提取（最新）');
  assert.equal(saved.patch.aiPromptConfig.assets.extraction.presetVersion, 4);
  assert.equal(saved.patch.aiPromptConfig.assets.extraction.body, '最新资产提取规则');
});

test('execution refreshes a single-book prompt override without touching another book', async () => {
  const calls = [];
  const store = presetStore();
  const latest = store.getPublished('script-extract-assets');
  latest.name = '单书资产提取（最新）'; latest.version = 4; latest.body = '单书最新规则';
  const result = await refreshBatchFactoryPresetSnapshot({
    username: 'alice', batchId: 'batch-1', bookId: 'book-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret', presetStore: store,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const batch = { id: 'batch-1', revision: 7, settingsState: { patch: {} }, books: [
        { id: 'book-1', revision: 5, settingsState: { patch: { aiPromptConfig: { assets: { extraction: { presetId: 'script-extract-assets', body: '旧正文' } } } } } },
        { id: 'book-2', revision: 6, settingsState: { patch: { aiPromptConfig: { assets: { extraction: { presetId: 'script-extract-assets', body: '另一书旧正文' } } } } } }
      ] };
      return new Response(JSON.stringify({ batch }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.deepEqual(result, { batchRefreshed: true, bookRefreshed: true });
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /books\/book-1\/override$/);
  assert.equal(JSON.parse(calls[2].init.body).patch.aiPromptConfig.assets.extraction.body, '单书最新规则');
});

test('execution initializes public script composition for a legacy batch without an AI prompt config', async () => {
  const calls = [];
  const result = await refreshBatchFactoryPresetSnapshot({
    username: 'alice', batchId: 'batch-1', goBaseUrl: 'http://go.local', bridgeSecret: 'secret', presetStore: presetStore(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const batch = { id: 'batch-1', revision: 7, settingsState: { patch: {} }, books: [] };
      return new Response(JSON.stringify({ batch }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.deepEqual(result, { batchRefreshed: true, bookRefreshed: false });
  assert.equal(calls.length, 2);
  const saved = JSON.parse(calls[1].init.body);
  assert.equal(saved.patch.aiPromptConfig.scriptComposition.segmented.presetId, 'script-segmented');
  assert.equal(saved.patch.aiPromptConfig.scriptComposition.shotlist.presetId, 'script-format-shotlist');
});
