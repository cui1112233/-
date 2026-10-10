const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchFankeVideoModels, buildFankeVideoPayload, parseFankeVideoStatus, fankeEndpoint } = require('../lib/fanke-open-video-adapter');

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

test('Fanke payload uses the selected provider model limits and accepts only HTTPS completed video URLs', () => {
  assert.equal(fankeEndpoint('/models').toString(), 'https://ai.fanke2026.xyz/api/open/v1/models');
  assert.deepEqual(buildFankeVideoPayload({
    providerModel: { id: 'minimax-h3-768p', durations: [8], resolutions: ['768p'], aspectRatios: ['9:16'], maxImageRefs: 1, promptMaxChars: 20 },
    prompt: '雨夜追车', duration: 8, resolution: '768p', aspectRatio: '9:16', imageUrls: ['https://assets.example/ref.png']
  }), {
    model: 'minimax-h3-768p', prompt: '雨夜追车', duration: 8, resolution: '768p', ratio: '9:16', imageUrls: ['https://assets.example/ref.png']
  });
  assert.deepEqual(parseFankeVideoStatus(JSON.stringify({ status: 'completed', videoUrl: 'https://assets.example/video.mp4' })), {
    status: 'succeeded', videoUrl: 'https://assets.example/video.mp4'
  });
  assert.throws(() => parseFankeVideoStatus(JSON.stringify({ status: 'completed', videoUrl: 'http://assets.example/video.mp4' })), /无法识别/);
});
