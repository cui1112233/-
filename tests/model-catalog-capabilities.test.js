const assert = require('node:assert/strict');
const test = require('node:test');

const { saveManagerModel, updateManagerModel } = require('../lib/model-catalog-runtime');

function catalogStore() {
  const configs = new Map([['manager', { modelCatalogVersion: 1, modelCatalog: [] }]]);
  return {
    read(username) { return configs.get(username) || {}; },
    write(username, config) { configs.set(username, config); },
    get(username) { return configs.get(username); }
  };
}

test('catalog CRUD persists only allowed custom capabilities and returns their safe form', () => {
  const store = catalogStore();
  const options = { configReader: store.read.bind(store), configWriter: store.write.bind(store) };
  const created = saveManagerModel('manager', {
    id: 'custom-video',
    kind: 'video',
    credential: 'secret',
    enabled: true,
    capabilities: {
      supportsReferenceImages: true,
      requiresImageInput: false,
      maxVideoDuration: 12,
      internalCredential: 'discard-me',
      maxConcurrentRequests: 999
    }
  }, options);

  assert.deepEqual(created.capabilities, {
    supportsReferenceImages: true,
    requiresImageInput: false,
    maxVideoDuration: 12
  });
  assert.deepEqual(store.get('manager').modelCatalog[0].capabilities, created.capabilities);
  assert.equal(JSON.stringify(created).includes('secret'), false);
  assert.equal(JSON.stringify(store.get('manager').modelCatalog[0]).includes('discard-me'), false);

  const updated = updateManagerModel('manager', 'custom-video', {
    capabilities: { maxVideoDuration: 61, unexpected: true }
  }, options);
  assert.deepEqual(updated.capabilities, {});
});
