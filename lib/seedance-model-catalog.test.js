const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeModelCatalog, resolveCatalogModel, publicModel } = require('./model-catalog');

test('Seedance 2.0 official is a configured video platform preset', () => {
  const catalog = normalizeModelCatalog([{
    id: 'seedance-2-0-official',
    kind: 'video',
    displayName: 'Seedance 2.0 官方',
    credential: 'yfai-test-key',
    enabled: true
  }], { modelCatalogVersion: 1 });

  const model = resolveCatalogModel(catalog, 'seedance-2-0-official', 'video');
  assert.equal(model.adapterKind, 'yfai_seedance');
  assert.equal(model.modelId, 'seedance-2-0-official');
  assert.equal(model.baseUrl, 'https://yf.token6688.com');
  assert.equal(publicModel(model).hasCredential, true);
});
