const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMediaSettings } = require('./media-settings');

test('keeps image 1:1 independent from the video fallback ratio', () => {
  assert.deepEqual(normalizeMediaSettings({ aspectRatio: '1:1' }), {
    imageAspectRatio: '1:1', videoAspectRatio: '9:16', videoResolution: '720p'
  });
});

test('accepts separate image and video settings', () => {
  assert.deepEqual(normalizeMediaSettings({ imageAspectRatio: '1:1', videoAspectRatio: '16:9', videoResolution: '1080p' }), {
    imageAspectRatio: '1:1', videoAspectRatio: '16:9', videoResolution: '1080p'
  });
});
