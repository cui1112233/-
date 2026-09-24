const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScriptDefaults } = require('./config');

test('normalizes script generation defaults without accepting unsupported ratios', () => {
  assert.deepEqual(normalizeScriptDefaults({
    textModelId: ' text-1 ', imageModelId: ' image-1 ', videoModelKey: 'seedance-2-0-official',
    imageAspectRatio: '1:1', videoAspectRatio: '16:9', videoResolution: '1080p'
  }), {
    textModelId: 'text-1', imageModelId: 'image-1', videoModelKey: 'seedance-2-0-official',
    imageAspectRatio: '1:1', videoAspectRatio: '16:9', videoResolution: '1080p'
  });
  assert.deepEqual(normalizeScriptDefaults({ imageAspectRatio: '4:3', videoAspectRatio: '1:1', videoResolution: '4k' }), {
    textModelId: '', imageModelId: '', videoModelKey: '', imageAspectRatio: '9:16', videoAspectRatio: '9:16', videoResolution: '720p'
  });
});
