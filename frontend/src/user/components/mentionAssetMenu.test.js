import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMentionAssets, findMentionTarget, findMentionToken } from './mentionAssetMenu.js';

test('findMentionToken keeps the typed name range at the caret', () => {
  assert.deepEqual(
    findMentionToken('【H3视听时间轴】 @镜前', 13),
    { start: 10, end: 13, query: '镜前' }
  );
});

test('findMentionTarget preserves the typed name while normalizing only its filter', () => {
  assert.deepEqual(
    findMentionTarget({ selectionStart: 9 }, '镜头 @Alice'),
    { start: 3, end: 9, query: 'Alice', filterQuery: 'alice', anchorRect: null }
  );
});

test('buildMentionAssets separates usable image assets from missing-image assets', () => {
  const result = buildMentionAssets(
    { query: '' },
    [{ id: 'c1', data: { 名称: '妻子' }, mainImageUrl: 'https://img/character.png' }],
    [{ id: 's1', data: { 名称: '镜前观察空间' } }]
  );

  assert.deepEqual(result, [
    { id: 'c1', type: 'characters', name: '妻子', mainImageUrl: 'https://img/character.png', hasImage: true },
    { id: 's1', type: 'scenes', name: '镜前观察空间', mainImageUrl: '', hasImage: false }
  ]);
});

test('buildMentionAssets filters only matching assets for a typed mention', () => {
  const result = buildMentionAssets(
    { query: '妻' },
    [
      { id: 'c1', data: { 名称: '妻子' }, mainImageUrl: 'https://img/character.png' },
      { id: 'c2', data: { 名称: '老公' }, mainImageUrl: 'https://img/husband.png' }
    ],
    []
  );

  assert.deepEqual(result.map(asset => asset.name), ['妻子']);
});
