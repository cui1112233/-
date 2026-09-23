import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInlineMentionSegments, canonicalTextFromSegments } from './scriptInlineMentions.js';

test('projects a pasted matching mention with its current main image', () => {
  assert.deepEqual(buildInlineMentionSegments('镜头里有@妻子。', [
    { kind: 'character', item: { id: 'c1', name: '妻子' }, imageUrl: '/wife.png' }
  ]), [
    { type: 'text', value: '镜头里有' },
    { type: 'mention', value: '@妻子', name: '妻子', kind: 'character', imageUrl: '/wife.png' },
    { type: 'text', value: '。' }
  ]);
});

test('leaves an ambiguous name as text', () => {
  assert.deepEqual(buildInlineMentionSegments('@客厅', [
    { kind: 'character', item: { id: 'c1', name: '客厅' }, imageUrl: '/a.png' },
    { kind: 'scene', item: { id: 's1', name: '客厅' }, imageUrl: '/b.png' }
  ]), [{ type: 'text', value: '@客厅' }]);
});

test('keeps a uniquely matched mention as a chip when its asset has no main image', () => {
  assert.deepEqual(buildInlineMentionSegments('屋内@客厅', [
    { kind: 'scene', item: { id: 's1', name: '客厅' }, imageUrl: '' }
  ]), [
    { type: 'text', value: '屋内' },
    { type: 'mention', value: '@客厅', name: '客厅', kind: 'scene', imageUrl: '' }
  ]);
});

test('serializes visual mention segments as the original plain-text prompt', () => {
  assert.equal(canonicalTextFromSegments([
    { type: 'text', value: '妻子看向' },
    { type: 'mention', value: '@客厅', name: '客厅', kind: 'scene', imageUrl: '/living-room.png' },
    { type: 'text', value: '。' }
  ]), '妻子看向@客厅。');
});
