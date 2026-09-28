import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFrame, overlapBoundary } from './scroll-merge.mjs';

const overlap = '姥姥怕我长大进去尝试改变我的想法发现无用无奈妥协老话说得好事不过三';
test('removes a repeated scrolling overlap but keeps new text', () => {
  const previous = '我没有正常的心理认知。' + overlap;
  const next = overlap + '如果有人惹你了至少给对方三次机会';
  assert.equal(appendFrame(previous, previous, next).body, previous + '如果有人惹你了至少给对方三次机会');
});
test('tolerates one OCR disagreement without swallowing new characters', () => {
  const altered = overlap.replace('想法', '想去');
  const boundary = overlapBoundary(overlap, altered + '如果有人惹你了至少给对方三次机会');
  assert.equal(boundary.offset, altered.length);
  assert.equal(boundary.edits, 1);
});
test('keeps an unaligned frame rather than deleting its content', () => {
  const next = '这是另一段没有重叠的文字必须保留并标记需要人工核对';
  assert.equal(appendFrame('旧段落', '旧段落', next).body, '旧段落\n\n' + next);
});
test('does not append a paused duplicate frame', () => {
  const result = appendFrame(overlap, overlap, overlap);
  assert.equal(result.body, overlap);
  assert.equal(result.skipped, true);
});

test('does not duplicate closing punctuation at a scrolling boundary', () => {
  const previous = '我答应了。' + overlap + '。”';
  const next = overlap + '。”\n如果有人惹你了至少给对方三次机会';
  assert.equal(appendFrame(previous, previous, next).body, previous + '\n如果有人惹你了至少给对方三次机会');
});
