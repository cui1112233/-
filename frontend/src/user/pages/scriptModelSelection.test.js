import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileScriptModelSelection } from './scriptModelSelection.js';

test('keeps each script selection while its configured model remains available', () => {
  assert.deepEqual(
    reconcileScriptModelSelection(
      { textModelId: 'text-qwen', imageModelId: 'image-flux' },
      {
        text: [{ id: 'text-qwen', displayName: 'Qwen', enabled: true }],
        image: [{ id: 'image-flux', displayName: 'Flux', enabled: true }]
      }
    ),
    { textModelId: 'text-qwen', imageModelId: 'image-flux', unavailableKinds: [] }
  );
});

test('clears only the selection whose configured model was removed or disabled', () => {
  assert.deepEqual(
    reconcileScriptModelSelection(
      { textModelId: 'text-qwen', imageModelId: 'image-flux' },
      {
        text: [{ id: 'text-qwen', displayName: 'Qwen', enabled: true }],
        image: [{ id: 'image-flux', displayName: 'Flux', enabled: false }]
      }
    ),
    { textModelId: 'text-qwen', imageModelId: '', unavailableKinds: ['image'] }
  );
});
