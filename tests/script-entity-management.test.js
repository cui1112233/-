const test = require('node:test');
const assert = require('node:assert/strict');

async function loadEntities() {
  return import('../frontend/src/user/pages/scriptEntities.js');
}

test('normalizes legacy entities into stable records and retains valid protagonists', async () => {
  const { normalizeExtractInfo } = await loadEntities();
  const result = normalizeExtractInfo({
    characters: [{ name: '沈清' }, '顾言'],
    scenes: [{ name: '书房' }],
    protagonistIds: ['legacy-missing']
  });

  assert.equal(result.characters.length, 2);
  assert.equal(result.scenes.length, 1);
  assert.ok(result.characters.every(item => item.id && Object.hasOwn(item, 'data')));
  assert.deepEqual(result.protagonistIds, []);
});

test('replaces duplicate entity IDs during normalization', async () => {
  const { normalizeExtractInfo } = await loadEntities();
  const result = normalizeExtractInfo({
    characters: [{ id: 'duplicate', data: { name: '沈清' } }, { id: 'duplicate', data: { name: '顾言' } }],
    scenes: [],
    protagonistIds: ['duplicate']
  });

  assert.equal(new Set(result.characters.map(item => item.id)).size, 2);
  assert.deepEqual(result.protagonistIds, ['duplicate']);
});

test('keeps existing entity IDs and returns only selected protagonists', async () => {
  const { normalizeExtractInfo, entityData, toGenerationEntities } = await loadEntities();
  const extractInfo = normalizeExtractInfo({
    characters: [
      { id: 'hero', data: { name: '沈清' } },
      { id: 'supporting', data: { name: '顾言' } }
    ],
    scenes: [{ id: 'scene-1', data: { name: '书房' } }],
    protagonistIds: ['hero', 'missing']
  });

  assert.deepEqual(extractInfo.protagonistIds, ['hero']);
  assert.deepEqual(entityData(extractInfo.characters[0]), { name: '沈清' });
  assert.deepEqual(toGenerationEntities(extractInfo), {
    characters: [{ name: '沈清' }, { name: '顾言' }],
    scenes: [{ name: '书房' }],
    protagonists: [{ name: '沈清' }]
  });
});

test('automatically selects explicitly labeled leads, otherwise the most-mentioned character', async () => {
  const { selectDefaultProtagonistIds } = await loadEntities();
  const characters = [
    { id: 'lead', data: { name: '沈清', 角色定位: '女主角' } },
    { id: 'supporting', data: { name: '顾言', 身份: '同事' } }
  ];
  assert.deepEqual(selectDefaultProtagonistIds({ characters, scenes: [] }, '顾言顾言顾言'), ['lead']);
  assert.deepEqual(selectDefaultProtagonistIds({
    characters: [{ id: 'a', data: { name: '林默' } }, { id: 'b', data: { name: '苏晚' } }],
    scenes: []
  }, '苏晚看见林默。苏晚转身。苏晚离开。'), ['b']);
});
