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

test('enabled models without their required configuration are not selectable', () => {
  const catalog = normalizeModelCatalog([
    { id: 'text-missing-key', kind: 'text', enabled: true },
    { id: 'yd2-mini-video', kind: 'video', enabled: true },
    { id: 'minimax-h3-video', kind: 'video', credential: 'h3-secret', enabled: true },
    { id: 'local-doubao-executor-video', kind: 'video', enabled: true }
  ], {});

  assert.equal(resolveCatalogModel(catalog, 'text-missing-key', 'text'), null);
  assert.equal(resolveCatalogModel(catalog, 'yd2-mini-video', 'video'), null);
  assert.equal(resolveCatalogModel(catalog, 'minimax-h3-video', 'video').id, 'minimax-h3-video');
  assert.equal(resolveCatalogModel(catalog, 'local-doubao-executor-video', 'video'), null);
});

test('local executor preset is selectable only after executor pairing', () => {
  const catalog = normalizeModelCatalog([
    { id: 'local-doubao-executor-video', kind: 'video', executorPaired: true, enabled: true }
  ], {});

  assert.equal(resolveCatalogModel(catalog, 'local-doubao-executor-video', 'video').id, 'local-doubao-executor-video');
});

test('custom records cannot claim a reserved platform preset id', () => {
  const catalog = normalizeModelCatalog([
    { id: 'minimax-h3-video', kind: 'text', credential: 'custom-secret', enabled: true }
  ], {});

  assert.deepEqual(catalog, []);
});

test('platform video presets retain their fixed adapter metadata', () => {
  assert.deepEqual(PLATFORM_PRESETS['yd2-mini-video'], {
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'yd_video',
    capabilities: { supportsReferenceImages: false, requiresImageInput: true, maxVideoDuration: 1 }
  });
  assert.deepEqual(PLATFORM_PRESETS['minimax-h3-video'], {
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'autodl_comfyui_video',
    capabilities: { supportsReferenceImages: true, requiresImageInput: false, maxVideoDuration: 15 }
  });
  assert.deepEqual(PLATFORM_PRESETS['local-doubao-executor-video'], {
    kind: 'video',
    credentialMode: 'executorPairing',
    adapterKind: 'local_executor_video',
    capabilities: { supportsReferenceImages: false, requiresImageInput: false, maxVideoDuration: 10 }
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

test('custom model capabilities are persisted as a bounded safe catalog field', () => {
  const model = normalizeModelCatalog([{
    id: 'custom-video',
    kind: 'video',
    credential: 'secret',
    enabled: true,
    capabilities: {
      supportsReferenceImages: true,
      requiresImageInput: false,
      maxVideoDuration: 12,
      credential: 'must-not-persist',
      arbitraryProviderFlag: 'must-not-persist'
    }
  }], { modelCatalogVersion: 1 })[0];

  assert.deepEqual(model.capabilities, {
    supportsReferenceImages: true,
    requiresImageInput: false,
    maxVideoDuration: 12
  });
  assert.deepEqual(publicModel(model).capabilities, model.capabilities);
  assert.equal(JSON.stringify(publicModel(model)).includes('must-not-persist'), false);
});

test('platform preset capabilities stay fixed instead of accepting client overrides', () => {
  const h3 = normalizeModelCatalog([{
    id: 'minimax-h3-video',
    credential: 'secret',
    enabled: true,
    capabilities: { supportsReferenceImages: false, requiresImageInput: true, maxVideoDuration: 1 }
  }], { modelCatalogVersion: 1 })[0];

  assert.deepEqual(h3.capabilities, {
    supportsReferenceImages: true,
    requiresImageInput: false,
    maxVideoDuration: 15
  });
});
