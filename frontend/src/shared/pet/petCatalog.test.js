import assert from 'node:assert/strict';
import test from 'node:test';
import { previewPetSelection } from './petCatalog.js';

test('previews a selected pet immediately through the companion event', () => {
  const events = [];
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent: event => events.push(event) };

  try {
    const pet = previewPetSelection('pixiu');
    assert.equal(pet.id, 'pixiu');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'qiantie:pet-selection');
    assert.equal(events[0].detail.pet.id, 'pixiu');
  } finally {
    globalThis.window = previousWindow;
  }
});
