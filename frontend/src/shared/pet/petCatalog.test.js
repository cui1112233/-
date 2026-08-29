import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULT_PET_ID, PET_DEFINITIONS, getPetDefinition, getPetOptions } from './petCatalog.js';

test('desktop pet catalog contains CM and pixiu', () => {
  assert.deepEqual(PET_DEFINITIONS.map(pet => pet.id), ['stacky', 'pixiu']);
  assert.equal(DEFAULT_PET_ID, 'stacky');
  assert.deepEqual(getPetOptions(), [
    { label: 'CM', value: 'stacky' },
    { label: '貔貅', value: 'pixiu' }
  ]);
});

test('pixiu reuses the CM behavior profiles while owning its visual identity', () => {
  const pixiu = getPetDefinition('pixiu');
  assert.equal(pixiu.id, 'pixiu');
  assert.equal(pixiu.displayName, '貔貅');
  assert.equal(pixiu.spritesheetPath, '/pets/pixiu/spritesheet.svg');
  assert.equal(pixiu.atlasProfile, 'stacky-v2');
  assert.equal(pixiu.behaviorProfile, 'cm-v1');
  assert.equal(pixiu.speechProfile, 'cm-v1');
  assert.equal(pixiu.renderMode, 'smooth');

  const atlas = readFileSync('pets/pixiu/spritesheet.svg', 'utf8');
  assert.match(atlas, /width="960" height="1430"/);
  assert.match(atlas, /id="pixiu-working"/);
  assert.match(atlas, /id="pixiu-success"/);
  assert.match(atlas, /id="pixiu-error"/);
});

test('unknown pets fall back to CM', () => {
  assert.equal(getPetDefinition('not-a-pet').id, 'stacky');
  assert.equal(getPetDefinition(null).id, 'stacky');
});
