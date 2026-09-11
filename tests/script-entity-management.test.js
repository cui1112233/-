const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPageSource = fs.readFileSync(path.resolve(__dirname, '..', 'frontend/src/user/pages/ScriptPage.jsx'), 'utf8');

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
    visualStyle: '',
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

test('entity editor renders the image panel and completes with normalized image fields', () => {
  assert.match(scriptPageSource, /import EntityImagePanel from ['"]\.\.\/components\/EntityImagePanel['"]/);
  assert.match(scriptPageSource, /import \{ normalizeEntityImages \} from ['"]\.\/scriptEntityImages['"]/);
  assert.match(scriptPageSource, /const \[images, setImages\] = useState\([^\n]*normalizeEntityImages/);
  assert.match(scriptPageSource, /setImages\(normalizeEntityImages\(entity \|\| \{\}\)\)/);
  assert.match(scriptPageSource, /className="entity-editor-layout"[\s\S]*<EntityImagePanel/);
  assert.match(scriptPageSource, /images=\{images\}/);
  assert.match(scriptPageSource, /onChange=\{updateImages\}/);
  assert.match(scriptPageSource, /onChange\(\{ \.\.\.fields, \.\.\.images \}\)/);
});

test('entity editor rejects image completions from a stale editor session', () => {
  assert.match(scriptPageSource, /editorSessionId: nextEntityEditorSessionId\(\)/);
  assert.match(scriptPageSource, /<EntityEditor\s+key=\{activeEntity\?\.editorSessionId \|\| 'closed'\}/);
  assert.match(scriptPageSource, /key=\{imageRequestKey\}/);
  assert.match(scriptPageSource, /requestKey=\{imageRequestKey\}/);
  assert.match(scriptPageSource, /sourceRequestKey !== activeImageRequestKey\.current/);
  assert.match(scriptPageSource, /setImages\(nextImages\)/);
});

test('new entity drafts keep one stable asset ID through completion', async () => {
  const { createEntity } = await loadEntities();
  assert.equal(createEntity({ name: '沈清' }, 'draft-character').id, 'draft-character');
  assert.match(scriptPageSource, /const draftEntity = createEntity\(data\)/);
  assert.match(scriptPageSource, /items\.push\(createEntity\(fields, activeEntity\.id\)\)/);
  assert.match(scriptPageSource, /assetId=\{activeEntity\?\.id \|\| ''\}/);
  assert.match(scriptPageSource, /assetId=\{assetId\}/);
  assert.match(scriptPageSource, /disabled=\{!assetId\}/);
});

test('legacy string entities keep their description field and empty image defaults', () => {
  assert.match(scriptPageSource, /typeof value === 'string'\) return \[\{ key: '描述', label: '设定 \/ 描述', value \}\]/);
  assert.match(scriptPageSource, /normalizeEntityImages\(entity \|\| \{\}\)/);
  assert.match(scriptPageSource, /!\['imageUrls', 'mainImageUrl'\]\.includes\(key\)/);
});
