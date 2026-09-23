import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScriptModelSelection, reconcileScriptModelSelection, saveScriptModelSelection } from './scriptModelSelection.js';

test('keeps an enabled configured script model and clears only unavailable selections', () => {
  assert.deepEqual(
    reconcileScriptModelSelection({ textModelId: 'text-a', imageModelId: 'image-a' }, {
      text: [{ id: 'text-a', enabled: true }],
      image: [{ id: 'image-a', enabled: false }]
    }),
    { textModelId: 'text-a', imageModelId: '', unavailableKinds: ['image'] }
  );
});

test('persists the current user selection without leaking it to another account', () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) || null };
  saveScriptModelSelection(storage, 'alice', { textModelId: 'text-a', imageModelId: 'image-a' });
  assert.deepEqual(loadScriptModelSelection(storage, 'alice'), { textModelId: 'text-a', imageModelId: 'image-a' });
  assert.deepEqual(loadScriptModelSelection(storage, 'bob'), { textModelId: '', imageModelId: '' });
});
