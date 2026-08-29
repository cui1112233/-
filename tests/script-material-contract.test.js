const test = require('node:test');
const assert = require('node:assert/strict');
async function loadContract() {
  return import('../lib/script-generation/material-contract.js');
}

test('preserves stable ids and starred/protagonist flags while adding missing ids', async () => {
  const { normalizeMaterialState } = await loadContract();
  const result = normalizeMaterialState({
    characters: [{ id: 'hero', data: { name: '沈清' }, starred: true }, { data: { name: '顾言' } }],
    scenes: [{ id: 'study', data: { name: '书房' } }],
    protagonistIds: ['hero', 'missing'], visualStyle: '电影写实'
  });
  assert.equal(result.characters[0].id, 'hero');
  assert.equal(result.characters[0].starred, true);
  assert.ok(result.characters[1].id);
  assert.equal(result.scenes[0].id, 'study');
  assert.deepEqual(result.protagonistIds, ['hero']);
  assert.equal(result.version, 1);
});

test('increments material version without changing entity ids', async () => {
  const { normalizeMaterialState, bumpMaterialVersion } = await loadContract();
  const state = normalizeMaterialState({ version: 4, characters: [{ id: 'hero', data: { name: '沈清' } }] });
  const next = bumpMaterialVersion(state);
  assert.equal(next.version, 5);
  assert.equal(next.characters[0].id, 'hero');
});

test('serializes a normalized JSON contract and rejects invalid JSON values', async () => {
  const { normalizeMaterialState, serializeMaterialState } = await loadContract();
  const parsed = JSON.parse(serializeMaterialState({ characters: [{ id: 'hero', data: { name: '沈清' } }] }));
  assert.equal(parsed.characters[0].id, 'hero');
  assert.throws(() => normalizeMaterialState('not-json'), /素材必须是 JSON 对象/);
});
