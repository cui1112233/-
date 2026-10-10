const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModelCatalog, publicModel } = require('../lib/model-catalog');
const { saveManagerModel } = require('../lib/model-catalog-runtime');

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

test('rejects enabling the Fanke preset before a provider model is selected', () => {
  assert.throws(() => saveManagerModel('manager-a', {
    id: 'fanke-open-video',
    displayName: '梵客视频 API',
    credential: 'key-a',
    enabled: true
  }, {
    configReader: () => ({}),
    configWriter: () => {}
  }), /请选择梵客视频模型/);
});
