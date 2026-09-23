import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePrecompiledStoryboardAssets } from './batchFactoryPrecompiledStoryboard.js';

test('keeps saved book assets visible while H3 director cards are waiting for VIDEO compilation', () => {
  const assets = resolvePrecompiledStoryboardAssets({
    videos: [],
    assetRecords: [
      { id: 'character-linwan', kind: 'character', name: '林晚' },
      { id: 'scene-livingroom', kind: 'scene', name: '客厅' },
      { id: 'prop-label', kind: 'prop', name: '姓名贴' }
    ],
    directorRevision: {
      output: {
        h3_director: { director_cards: [{ id: 'card-1', source_text: '林晚在客厅整理姓名贴。' }] }
      }
    }
  });

  assert.deepEqual(assets.map(asset => asset.name), ['林晚', '客厅', '姓名贴']);
});

test('does not treat ordinary unprocessed books as precompiled storyboards', () => {
  const assets = resolvePrecompiledStoryboardAssets({
    videos: [],
    assetRecords: [{ id: 'character-linwan', kind: 'character', name: '林晚' }],
    directorRevision: { output: {} }
  });

  assert.deepEqual(assets, []);
});
