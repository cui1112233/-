const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchFankeVideoModels } = require('../lib/fanke-open-video-adapter');

test('Fanke directory exposes only available video models', async () => {
  const models = await fetchFankeVideoModels({ apiKey: 'private-key', request: async request => {
    assert.equal(request.headers.Authorization, 'Bearer private-key');
    assert.equal(request.headers['X-Public-Model-Ids'], '1');
    return { statusCode: 200, text: JSON.stringify({ data: [
      { id: 'ft-video-v1-ready', name: 'Ready', type: 'video', status: 'available', durations: [5], resolutions: ['720p'], aspect_ratios: ['9:16'], max_image_refs: 9 },
      { id: 'ft-image-v1-ready', name: 'Image', type: 'image', status: 'available' },
      { id: 'ft-video-v1-waiting', name: 'Waiting', type: 'video', status: 'replenishing' }
    ] }) };
  }});
  assert.deepEqual(models, [{
    id: 'ft-video-v1-ready', name: 'Ready', durations: [5], resolutions: ['720p'], aspectRatios: ['9:16'],
    maxImageRefs: 9, maxVideoRefs: null, maxAudioRefs: null, promptMaxChars: null, audioRequiresImage: false
  }]);
});
