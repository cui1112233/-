import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInlineMentionNodes, replaceMentionToken } from './inlineMentionDocument.js';

test('buildInlineMentionNodes renders only primary-image mentions as labels', () => {
  const nodes = buildInlineMentionNodes('@妻子 看向 @老公', [
    { name: '妻子', hasImage: true, mainImageUrl: 'wife.png' },
    { name: '老公', hasImage: false, mainImageUrl: '' }
  ]);

  assert.deepEqual(nodes, [
    { kind: 'mention', text: '@妻子', name: '妻子', imageUrl: 'wife.png' },
    { kind: 'text', text: ' 看向 @老公' }
  ]);
});

test('replaceMentionToken inserts a text-only subject as ordinary prompt text', () => {
  assert.deepEqual(
    replaceMentionToken('画面：@老', { start: 3, end: 5 }, { name: '老公', hasImage: false }),
    { text: '画面：@老公 ', caret: 7 }
  );
});
