const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MODEL_KINDS,
  PLATFORM_PRESETS,
  normalizeModelCatalog,
  publicModel,
  resolveCatalogModel
} = require('../lib/model-catalog');

test('new manager has no available model until a configured model is enabled', () => {
  const catalog = normalizeModelCatalog([], {});

  assert.deepEqual(catalog, []);
  assert.equal(resolveCatalogModel(catalog, 'minimax-h3-video', 'video'), null);
});

test('enabled models resolve only within their declared model kind', () => {
  const catalog = normalizeModelCatalog([
    { id: 'text-gpt54', kind: 'text', displayName: 'GPT-5.4', credential: 'text-secret', enabled: true },
    { id: 'image-flux', kind: 'image', displayName: 'Flux', credential: 'image-secret', enabled: true },
    { id: 'video-disabled', kind: 'video', displayName: 'Disabled video', credential: 'video-secret', enabled: false }
  ], {});

  assert.deepEqual(MODEL_KINDS, ['text', 'video', 'image']);
  assert.equal(resolveCatalogModel(catalog, 'text-gpt54', 'text').displayName, 'GPT-5.4');
  assert.equal(resolveCatalogModel(catalog, 'text-gpt54', 'video'), null);
  assert.equal(resolveCatalogModel(catalog, 'image-flux', 'image').displayName, 'Flux');
  assert.equal(resolveCatalogModel(catalog, 'video-disabled', 'video'), null);
});

test('platform video presets retain their fixed adapter metadata', () => {
  assert.deepEqual(PLATFORM_PRESETS['yd2-mini-video'], {
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'yd_video'
  });
  assert.deepEqual(PLATFORM_PRESETS['minimax-h3-video'], {
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'autodl_comfyui_video',
    supportsReferenceImages: true
  });
  assert.deepEqual(PLATFORM_PRESETS['local-doubao-executor-video'], {
    kind: 'video',
    credentialMode: 'executorPairing',
    adapterKind: 'local_executor_video'
  });
});

test('public model never exposes credential', () => {
  const model = normalizeModelCatalog([
    { id: 'text-gpt54', kind: 'text', displayName: 'GPT-5.4', credential: 'secret', enabled: true }
  ], {})[0];

  const safe = publicModel(model);
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'credential'), false);
  assert.equal(safe.displayName, 'GPT-5.4');
});
