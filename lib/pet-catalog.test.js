const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_PET_ID, findPetDefinition, normalizePetConfig, PET_DEFINITIONS } = require('./pet-catalog');

test('legacy or missing pet values resolve to CM', () => {
  assert.equal(DEFAULT_PET_ID, 'stacky');
  assert.equal(normalizePetConfig(undefined).id, 'stacky');
  assert.equal(normalizePetConfig({}).id, 'stacky');
});

test('Pixiu is a legal canonical pet definition', () => {
  assert.equal(findPetDefinition('pixiu').id, 'pixiu');
  assert.deepEqual(PET_DEFINITIONS.map(pet => pet.id), ['stacky', 'pixiu']);
  assert.equal(normalizePetConfig('pixiu').spritesheetPath, '/pets/pixiu/spritesheet.webp');
});

test('invalid pet preserves a valid existing selection and otherwise falls back to CM', () => {
  assert.equal(normalizePetConfig('not-a-pet', 'pixiu').id, 'pixiu');
  assert.equal(normalizePetConfig('not-a-pet', { id: 'not-a-pet' }).id, 'stacky');
});
