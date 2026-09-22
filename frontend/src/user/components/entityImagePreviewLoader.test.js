import assert from 'node:assert/strict';
import test from 'node:test';

import { createEntityImagePreviewLoader } from './entityImagePreviewLoader.js';

test('image preview loader records failed images without blocking successful previews', async () => {
  const loader = createEntityImagePreviewLoader(['ok', 'bad'], {
    loadImage: async url => {
      if (url === 'bad') throw new Error('not found');
      return new Blob(['image']);
    },
    createObjectUrl: () => 'blob:ok',
    revokeObjectUrl: () => {}
  });

  assert.deepEqual(await loader.promise, {
    previews: { ok: 'blob:ok' },
    failed: ['bad']
  });
});
