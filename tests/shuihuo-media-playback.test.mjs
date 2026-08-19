import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryAudioForSegment } from '../frontend/src/user/pages/shuihuo/mediaPlayback.js';

test('primaryAudioForSegment prefers primary audio in the requested segment', () => {
  const media = [
    { id: 1, kind: 'audio', segmentId: 3 },
    { id: 2, kind: 'audio', segmentId: 3, isPrimary: true },
    { id: 3, kind: 'audio', segmentId: 4, isPrimary: true },
    { id: 4, kind: 'image', segmentId: 3, isPrimary: true }
  ];

  assert.equal(primaryAudioForSegment(media, 3)?.id, 2);
  assert.equal(primaryAudioForSegment(media, 9), null);
});
