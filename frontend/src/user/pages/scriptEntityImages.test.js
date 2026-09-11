import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendEntityImage,
  normalizeEntityImages,
  removeEntityImage,
  selectEntityImage
} from './scriptEntityImages.js';

test('normalizes image URLs and keeps an empty main image for an empty entity', () => {
  assert.deepEqual(normalizeEntityImages({ imageUrls: [], mainImageUrl: '' }), {
    imageUrls: [],
    mainImageUrl: ''
  });
});

test('normalizes blanks and duplicates and auto-selects a single image', () => {
  assert.deepEqual(normalizeEntityImages({ imageUrls: [' a ', '', 'a', 'b '], mainImageUrl: 'missing' }), {
    imageUrls: ['a', 'b'],
    mainImageUrl: ''
  });
  assert.deepEqual(normalizeEntityImages({ imageUrls: [' a ', 'a'], mainImageUrl: '' }), {
    imageUrls: ['a'],
    mainImageUrl: 'a'
  });
});

test('append selects the only image but preserves an existing main image', () => {
  assert.deepEqual(appendEntityImage({ imageUrls: ['a'], mainImageUrl: 'a' }, 'b'), {
    imageUrls: ['a', 'b'], mainImageUrl: 'a'
  });
});

test('selecting an image makes it the main image', () => {
  assert.deepEqual(selectEntityImage({ imageUrls: ['a', 'b'], mainImageUrl: '' }, ' b '), {
    imageUrls: ['a', 'b'], mainImageUrl: 'b'
  });
});

test('removing the main image selects the next remaining image', () => {
  assert.deepEqual(removeEntityImage({ imageUrls: ['a', 'b'], mainImageUrl: 'a' }, 'a'), {
    imageUrls: ['b'], mainImageUrl: 'b'
  });
});

test('removing the final image clears the main image', () => {
  assert.deepEqual(removeEntityImage({ imageUrls: ['a'], mainImageUrl: 'a' }, 'a'), {
    imageUrls: [], mainImageUrl: ''
  });
});
