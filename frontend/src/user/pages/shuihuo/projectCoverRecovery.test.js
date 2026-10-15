import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverProjectCover } from './projectCoverRecovery.js';

test('uses a successful provider video even when the migrated batch has no video cards', async () => {
  const result = await recoverProjectCover('batch-1', async id => {
    assert.equal(id, 'batch-1');
    return { jobs: [{ tasks: [
      { status: 'failed', mediaUrl: '/failed.mp4' },
      { status: 'succeeded', mediaUrl: '/existing.mp4' }
    ] }] };
  });
  assert.deepEqual(result, { kind: 'video', url: '/existing.mp4' });
});

test('keeps a project usable when cover status cannot be loaded', async () => {
  assert.equal(await recoverProjectCover('batch-1', async () => { throw new Error('offline'); }), null);
  assert.equal(await recoverProjectCover('batch-1', async () => ({ jobs: [] })), null);
});
