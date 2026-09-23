import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryMergeCoverFrom } from './batchFactoryMergeCover.js';

test('uses an existing successful merged video as the cover when no shot video is available', () => {
  const batch = { books: [{ id: 'book-1', videos: [{ id: 'video-1' }] }] };
  const mergeStatus = { jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: '/api/batch-factory/v12/batches/batch-1/merge-media/final.mp4' }] };

  assert.deepEqual(
    batchFactoryMergeCoverFrom(batch, mergeStatus),
    { kind: 'video', url: '/api/batch-factory/v12/batches/batch-1/merge-media/final.mp4' }
  );
});
