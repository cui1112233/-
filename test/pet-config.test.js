const assert = require('node:assert/strict');
const test = require('node:test');

let catalog = null;
try {
  catalog = require('../lib/pet-catalog');
} catch {
  catalog = null;
}

test('server exposes canonical stacky and pixiu pet definitions', () => {
  assert.ok(catalog, 'lib/pet-catalog.js should exist');
  assert.deepEqual(catalog.PET_DEFINITIONS.map(pet => pet.id), ['stacky', 'pixiu']);
  assert.equal(catalog.findPetDefinition('pixiu').spritesheetPath, '/pets/pixiu/spritesheet.svg');
});

test('normalization accepts pixiu and ignores client-owned pet metadata', () => {
  assert.ok(catalog, 'lib/pet-catalog.js should exist');
  const normalized = catalog.normalizePetConfig({
    id: 'pixiu',
    displayName: 'tampered',
    spritesheetPath: 'https://example.com/not-allowed.svg'
  });
  assert.equal(normalized.id, 'pixiu');
  assert.equal(normalized.displayName, '貔貅');
  assert.equal(normalized.spritesheetPath, '/pets/pixiu/spritesheet.svg');
});

test('invalid pet ids keep the previous valid pet before falling back to CM', () => {
  assert.ok(catalog, 'lib/pet-catalog.js should exist');
  assert.equal(catalog.normalizePetConfig({ id: 'bad' }, { id: 'pixiu' }).id, 'pixiu');
  assert.equal(catalog.normalizePetConfig({ id: 'bad' }).id, 'stacky');
});
