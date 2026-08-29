import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeConfigPayload } from './configPayload.js';

test('config payload sends only the selected pet id to the Go API', () => {
  const payload = normalizeConfigPayload({
    provider: 'openai',
    pet: { id: 'pixiu', displayName: '貔貅', spritesheetPath: '/pets/pixiu/spritesheet.svg' }
  });

  assert.deepEqual(payload, {
    provider: 'openai',
    pet: 'pixiu'
  });
});

test('config payload preserves an existing string pet id', () => {
  assert.deepEqual(normalizeConfigPayload({ pet: 'stacky' }), { pet: 'stacky' });
});

test('config payload omits unusable pet values instead of serializing client metadata', () => {
  assert.deepEqual(normalizeConfigPayload({ pet: { displayName: 'broken' }, model: 'gpt-4.1' }), { model: 'gpt-4.1' });
});
