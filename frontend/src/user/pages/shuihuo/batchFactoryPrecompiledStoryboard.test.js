import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePrecompiledStoryboardAssets,
  resolvePrecompiledStoryboardFrame,
  resolvePrecompiledVideoWorkspace
} from './batchFactoryPrecompiledStoryboard.js';

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

test('opens an explicit H3 video workspace before final VIDEO segments exist', () => {
  const workspace = resolvePrecompiledVideoWorkspace({
    videos: [],
    directorRevision: {
      output: {
        h3_director: {
          director_cards: [{
            source_text: '我能看见人的前程。',
            action: '我抬眸看向前方。',
            camera: { shot_size: '近景', shot_angle: '平视' }
          }]
        }
      }
    }
  });

  assert.equal(workspace.status, 'awaiting_compilation');
  assert.equal(workspace.cards.length, 1);
  assert.equal(workspace.cards[0].action, '我抬眸看向前方。');
});

test('gives precompiled H3 cards a stable cross-column cursor and honors the selected card', () => {
  const book = {
    videos: [],
    directorRevision: {
      output: {
        h3_director: {
          director_cards: [
            { source_key: 'line_0001', source_text: '第一行', action: '动作一' },
            { source_key: 'line_0002', source_text: '第二行', action: '动作二' }
          ]
        }
      }
    }
  };

  const first = resolvePrecompiledStoryboardFrame(book);
  const second = resolvePrecompiledStoryboardFrame(book, 'h3:line_0002');

  assert.equal(first.key, 'h3:line_0001');
  assert.equal(first.index, 0);
  assert.equal(second.key, 'h3:line_0002');
  assert.equal(second.index, 1);
  assert.equal(second.card.action, '动作二');
});
