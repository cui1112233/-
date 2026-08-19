import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBatchSegmentIds } from '../frontend/src/user/pages/shuihuo/batchSelection.js';

const segments = [
  { id: 1, orderIndex: 1, confirmed: true },
  { id: 2, orderIndex: 2, confirmed: true },
  { id: 3, orderIndex: 3, confirmed: false },
  { id: 4, orderIndex: 4, confirmed: true }
];

const media = [
  { kind: 'image', segmentId: 1, isPrimary: true },
  { kind: 'video', segmentId: 1 },
  { kind: 'image', segmentId: 2, isPrimary: true }
];

test('selectBatchSegmentIds respects confirmation, video primary images, completion and range', () => {
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'video', scope: 'all' }), [1, 2]);
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'video', scope: 'incomplete' }), [2]);
  assert.deepEqual(selectBatchSegmentIds({ segments, media, kind: 'image', scope: 'range', start: 2, end: 4 }), [2, 4]);
});
