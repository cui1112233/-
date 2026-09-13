const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_FACTORY_PRESET_REQUIREMENTS,
  isPublishedPresetAllowed
} = require('./system-preset-catalog');

test('Batch Factory extraction accepts a published script extraction preset only', () => {
  assert.equal(isPublishedPresetAllowed(
    { module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), true);
  assert.equal(isPublishedPresetAllowed(
    { module: 'batch-factory', kind: 'base', protocolLock: { slot: 'batch.character-meta' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), false);
});

test('Batch Factory character and scene rules reject each other', () => {
  const character = { module: 'batch-factory', kind: 'base', protocolLock: { slot: 'batch.character-meta' } };
  assert.equal(isPublishedPresetAllowed(character, BATCH_FACTORY_PRESET_REQUIREMENTS['assets.character']), true);
  assert.equal(isPublishedPresetAllowed(character, BATCH_FACTORY_PRESET_REQUIREMENTS['assets.scene']), false);
});

test('Batch Factory constraint selections accept only published script constraint slots', () => {
  const constraint = { module: 'script', kind: 'addon', protocolLock: { format: 'constraint', slot: 'script.constraint.quality' } };
  assert.equal(isPublishedPresetAllowed(constraint, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), true);
  assert.equal(isPublishedPresetAllowed({ ...constraint, kind: 'base' }, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), false);
});
