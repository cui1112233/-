import test from 'node:test';
import assert from 'node:assert/strict';
import { filterShotMentionCandidates, findActiveShotMention, insertActiveShotMention, replaceActiveShotMention } from './scriptShotMentions.js';

test('finds an at-mention at the cursor while preserving following shot text', () => {
  const text = '林溪走进客厅，@卫铭 回头看她';
  const cursor = text.indexOf(' 回头');

  assert.deepEqual(findActiveShotMention(text, cursor), {
    start: text.indexOf('@卫铭'),
    end: cursor,
    query: '卫铭'
  });
});

test('does not treat a completed mention before the cursor as active', () => {
  assert.equal(findActiveShotMention('@林溪 走进客厅', '@林溪 走进客厅'.length), null);
});

test('replaces only the active mention near the cursor', () => {
  const text = '林溪走进客厅，@卫铭 回头看她';
  const cursor = text.indexOf(' 回头');

  assert.equal(
    replaceActiveShotMention(text, findActiveShotMention(text, cursor), '林溪'),
    '林溪走进客厅，@林溪 回头看她'
  );
});

test('filters character and scene candidates by the mention nearest the cursor', () => {
  assert.deepEqual(
    filterShotMentionCandidates({
      characters: [{ id: 'c1', name: '卫铭' }, { id: 'c2', name: '林溪' }],
      scenes: [{ id: 's1', name: '卫家客厅' }],
      query: '卫',
      label: item => item.name
    }),
    [
      { kind: 'character', item: { id: 'c1', name: '卫铭' } },
      { kind: 'scene', item: { id: 's1', name: '卫家客厅' } }
    ]
  );
});

test('inserts a selected mention at the cursor without moving following shot text', () => {
  const text = '林溪走进客厅，@卫 回头看她';
  const mention = findActiveShotMention(text, text.indexOf(' 回头'));

  assert.deepEqual(insertActiveShotMention(text, mention, '卫铭'), {
    text: '林溪走进客厅，@卫铭 回头看她',
    cursor: '林溪走进客厅，@卫铭'.length
  });
});
