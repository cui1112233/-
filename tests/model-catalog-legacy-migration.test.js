const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeModelCatalog, resolveCatalogModel } = require('../lib/model-catalog');
const { getVideoApiKey } = require('../lib/shared');

test('legacy credentials migrate into their matching catalog kinds without creating defaults', () => {
  const catalog = normalizeModelCatalog([], {
    baseUrl: 'https://text.example/v1',
    model: 'gpt-5.4',
    apiKey: 'legacy-text-secret',
    image: {
      provider: 'openai_compatible',
      baseUrl: 'https://image.example/v1',
      model: 'flux-pro',
      apiKey: 'legacy-image-secret'
    },
    video: {
      ydApiKey: 'legacy-yd-secret',
      h3ApiKey: 'legacy-h3-secret'
    }
  });

  const text = catalog.find(model => model.kind === 'text');
  const image = catalog.find(model => model.kind === 'image');

  assert.deepEqual([text.displayName, text.baseUrl, text.modelId, text.credential, text.enabled], [
    'gpt-5.4', 'https://text.example/v1', 'gpt-5.4', 'legacy-text-secret', true
  ]);
  assert.deepEqual([image.displayName, image.baseUrl, image.modelId, image.credential, image.enabled], [
    'flux-pro', 'https://image.example/v1', 'flux-pro', 'legacy-image-secret', true
  ]);
  assert.equal(resolveCatalogModel(catalog, 'yd2-mini-video', 'video').credential, 'legacy-yd-secret');
  assert.equal(resolveCatalogModel(catalog, 'minimax-h3-video', 'video').credential, 'legacy-h3-secret');
});

test('generic legacy video key migrates to YD only and never creates an H3 model', () => {
  const catalog = normalizeModelCatalog([], { video: { apiKey: 'generic-video-secret' } });

  assert.equal(resolveCatalogModel(catalog, 'yd2-mini-video', 'video').credential, 'generic-video-secret');
  assert.equal(resolveCatalogModel(catalog, 'minimax-h3-video', 'video'), null);
});

test('legacy config without credentials does not create a catalog model', () => {
  const catalog = normalizeModelCatalog([], {
    baseUrl: 'https://text.example/v1',
    model: 'gpt-5.4',
    image: { baseUrl: 'https://image.example/v1', model: 'flux-pro' },
    video: { ydApiKey: '', h3ApiKey: '' }
  });

  assert.deepEqual(catalog, []);
});

test('a versioned catalog never reimports credentials from retained legacy fields', () => {
  const catalog = normalizeModelCatalog([], {
    modelCatalogVersion: 1,
    apiKey: 'retained-text-secret',
    video: { h3ApiKey: 'retained-h3-secret' }
  });

  assert.deepEqual(catalog, []);
});

test('versioned catalog never falls back to retained legacy video keys at runtime', () => {
  const config = {
    modelCatalogVersion: 1,
    modelCatalog: [],
    video: { ydApiKey: 'retained-yd-secret', h3ApiKey: 'retained-h3-secret', apiKey: 'retained-generic-secret' }
  };

  assert.equal(getVideoApiKey(config, 'yd'), '');
  assert.equal(getVideoApiKey(config, 'h3'), '');
});
