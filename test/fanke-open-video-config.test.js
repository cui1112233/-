const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModelCatalog, publicModel } = require('../lib/model-catalog');

test('Fanke preset redacts API key but persists selected model', () => {
  const saved = normalizeModelCatalog([{
    id: 'fanke-open-video', kind: 'video', enabled: true, credential: 'private-key',
    providerModel: { id: 'ft-video-v1-ready', name: 'Ready', durations: [5], resolutions: ['720p'], aspectRatios: ['9:16'], maxImageRefs: 9 }
  }], { modelCatalogVersion: 1 })[0];
  assert.equal(saved.modelId, 'ft-video-v1-ready');
  assert.equal(saved.providerModel.maxImageRefs, 9);
  assert.equal(publicModel(saved).credential, undefined);
  assert.equal(publicModel(saved).hasCredential, true);
});
