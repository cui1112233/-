const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolveV11GoBaseUrl,
  enrichBatchFactorySystemPresetConfig,
  redactBatchFactorySystemPromptBodies,
  generateBatchFactoryAssetImages,
  upstreamErrorMessage
} = require('../routes/batch-factory-v11');

function publicScriptPreset(id) {
  const slots = {
	'script-extract-assets': 'script.asset-extraction',
    'script-segmented': 'script.segmented',
    'script-format-shotlist': 'script.format.shotlist',
    'script-general': 'script.general',
    'script-character-focus': 'script.character-focus',
    'script-audio-match': 'script.audio-match',
    'script-card-protocol': 'script.card.protocol',
    'script-constraint-wrapper': 'script.constraint.wrapper'
  };
  return slots[id]
    ? { id, module: 'script', kind: 'base', name: id, version: 1, body: `${id} body`, ...(id === 'script-extract-assets' ? { extractionPreset: true } : {}), protocolLock: { slot: slots[id], ...(id === 'script-extract-assets' ? { format: 'extract' } : {}) } }
    : null;
}

test('V11 uses its dedicated upstream when configured', () => {
  assert.equal(
    resolveV11GoBaseUrl({
      QIANTIE_BATCH_FACTORY_V11_BASE_URL: 'http://batch-factory-v11:4000',
      QIANTIE_GO_BASE_URL: 'http://backend:4000'
    }),
    'http://batch-factory-v11:4000'
  );
});

test('V11 keeps the legacy Go upstream as its compatibility fallback', () => {
  assert.equal(resolveV11GoBaseUrl({ QIANTIE_GO_BASE_URL: 'http://backend:4000' }), 'http://backend:4000');
});

test('V11 preserves a controlled Go stage error instead of mislabeling it as an unavailable service', () => {
  const error = new Error('capability unavailable');
  error.code = 'BATCH_FACTORY_V11_UPSTREAM_FAILED';
  assert.equal(upstreamErrorMessage(error, 502), 'capability unavailable');
});

test('V11 resolves its selected catalog model without the legacy default-text-model reader', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(appSource, /const resolvedConfigReader = configReader \|\| readConfig;/);
  assert.match(appSource, /createBatchFactoryV11Router\(\{[\s\S]*?configReader: resolvedConfigReader[\s\S]*?\}\)\);/);
});

test('V11 resolves a selected Batch Factory system preset only on the trusted hop', () => {
  const presetStore = {
    getPublished(id) {
      return publicScriptPreset(id) || (id === 'batch-video-meta'
        ? { id, module: 'batch-factory', kind: 'base', name: '视频提示词', version: 3, protocolLock: { slot: 'batch.video-meta' } }
        : null);
    },
    listAll: () => []
  };
  const body = enrichBatchFactorySystemPresetConfig({
    patch: { aiPromptConfig: { video: { enabled: true, presetId: 'batch-video-meta', prompt: '' } } }
  }, presetStore, (_store, id) => id === 'batch-video-meta' ? '受保护的视频系统提示词' : `${id} body`);

  assert.equal(body.patch.aiPromptConfig.video.body, '受保护的视频系统提示词');
  assert.equal(body.patch.aiPromptConfig.video.presetName, '视频提示词');
  assert.equal(body.patch.aiPromptConfig.video.presetVersion, 3);
  assert.equal(body.patch.aiPromptConfig.video.presetSlot, 'batch.video-meta');
});

test('V12 keeps separately selected character and scene asset prompt snapshots', () => {
  const assetPresets = {
    'batch-character-meta': { id: 'batch-character-meta', module: 'batch-factory', kind: 'base', name: '人物输出', version: 2, protocolLock: { slot: 'batch.character-meta' } },
    'batch-scene-meta': { id: 'batch-scene-meta', module: 'batch-factory', kind: 'base', name: '场景输出', version: 2, protocolLock: { slot: 'batch.scene-meta' } }
  };
  const presetStore = {
    getPublished(id) { return publicScriptPreset(id) || assetPresets[id] || null; },
    listAll: () => []
  };
  const result = enrichBatchFactorySystemPresetConfig({
    patch: { aiPromptConfig: { assets: {
      enabled: true,
      extraction: { presetId: 'script-extract-assets' },
      character: { presetId: 'batch-character-meta' },
      scene: { presetId: 'batch-scene-meta' }
    } } }
  }, presetStore, (_store, id) => `${id} protected body`);

  assert.equal(result.patch.aiPromptConfig.assets.character.presetSlot, 'batch.character-meta');
  assert.equal(result.patch.aiPromptConfig.assets.scene.presetSlot, 'batch.scene-meta');
  assert.equal(result.patch.aiPromptConfig.assets.scene.body, 'batch-scene-meta protected body');
});

test('V11 rejects a system preset outside the Batch Factory category', () => {
  const presetStore = { getPublished: id => publicScriptPreset(id) || ({ id: 'shuihuo-video-prompt', module: 'shuihuo-production' }), listAll: () => [] };
  assert.throws(
    () => enrichBatchFactorySystemPresetConfig({ patch: { aiPromptConfig: { video: { presetId: 'shuihuo-video-prompt' } } } }, presetStore, () => 'secret'),
    /视频提示词预设词/
  );
});

test('V11 never returns stored system preset bodies to the browser', () => {
  const response = redactBatchFactorySystemPromptBodies({
    batch: { settingsState: { patch: { aiPromptConfig: { video: { presetId: 'batch-video-meta', prompt: '受保护正文' } } } } }
  });
  assert.equal(response.batch.settingsState.patch.aiPromptConfig.video.prompt, undefined);
  assert.equal(response.batch.settingsState.patch.aiPromptConfig.video.presetId, 'batch-video-meta');
});

test('V11 asset image generation resolves an account image model then stores real image bytes in the book asset version library', async () => {
  assert.equal(typeof generateBatchFactoryAssetImages, 'function');
  const calls = [];
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64');
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'http://v11.test/api/batch-factory/v11/batches/b1/books/k1/assets') {
      return new Response(JSON.stringify({ assets: [{ id: 'a1', name: '林晚', prompt: '黑发女医生' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://image.example/v1/images/generations') {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'image-1');
      assert.match(body.prompt, /黑发女医生/);
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'http://v11.test/api/batch-factory/v11/batches/b1/books/k1/assets/a1/images/upload') {
      const body = JSON.parse(options.body);
      assert.match(body.dataUrl, /^data:image\/png;base64,/);
      return new Response(JSON.stringify({ image: { id: 'img1', assetId: 'a1', isPrimary: true } }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const result = await generateBatchFactoryAssetImages({
    username: 'alice',
    isOwner: false,
    batchId: 'b1',
    bookId: 'k1',
    assetIds: ['a1'],
    modelId: 'image-model',
    aspectRatio: '9:16',
    bridgeSecret: 'test-secret',
    goBaseUrl: 'http://v11.test',
    fetchImpl,
    resolveImageModel: () => ({ id: 'image-model', baseUrl: 'https://image.example/v1', modelId: 'image-1', credential: 'secret' })
  });

  assert.deepEqual(result.images, [{ id: 'img1', assetId: 'a1', isPrimary: true }]);
  assert.equal(calls.length, 3);
});

test('V11 refreshes preset snapshots with the runtime bridge secret when no override is supplied', async () => {
  const { refreshBatchFactoryPresetSnapshot } = require('../routes/batch-factory-v11');
  const previous = process.env.QIANTIE_BRIDGE_SECRET;
  process.env.QIANTIE_BRIDGE_SECRET = 'runtime-bridge-secret';
  try {
    let capturedHeaders;
    const result = await refreshBatchFactoryPresetSnapshot({
      username: 'alice',
      batchId: 'b1',
      goBaseUrl: 'http://v11.test',
      presetStore: { getPublished: id => publicScriptPreset(id), listAll: () => [] },
      fetchImpl: async (_url, options) => {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ batch: { id: 'b1', books: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.deepEqual(result, { batchRefreshed: true, bookRefreshed: false });
    assert.equal(capturedHeaders['X-Qiantie-Username'], 'alice');
    assert.ok(capturedHeaders['X-Qiantie-Signature']);
  } finally {
    if (previous === undefined) delete process.env.QIANTIE_BRIDGE_SECRET;
    else process.env.QIANTIE_BRIDGE_SECRET = previous;
  }
});
