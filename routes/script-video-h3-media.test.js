const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveH3VideoMedia } = require('./script-video');

test('maps configured H3 video orientation and resolution tier', () => {
  assert.deepEqual(
    resolveH3VideoMedia({ aspectRatio: '9:16', resolution: '480p' }),
    { aspectRatio: '9:16', resolution: '480p竖' }
  );
  assert.deepEqual(
    resolveH3VideoMedia({ aspectRatio: '16:9', resolution: '480p' }),
    { aspectRatio: '16:9', resolution: '480p横' }
  );
  assert.deepEqual(
    resolveH3VideoMedia({ aspectRatio: '9:16', resolution: '720p' }),
    { aspectRatio: '9:16', resolution: '768p竖' }
  );
  assert.deepEqual(
    resolveH3VideoMedia({ aspectRatio: '16:9', resolution: '1080p' }),
    { aspectRatio: '16:9', resolution: '768p横' }
  );
});

test('keeps legacy H3 resolution values compatible', () => {
  assert.deepEqual(
    resolveH3VideoMedia({ aspectRatio: '9:16', resolution: '480p横' }),
    { aspectRatio: '16:9', resolution: '480p横' }
  );
});
