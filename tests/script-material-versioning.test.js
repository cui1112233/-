const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageSource = fs.readFileSync(require('node:path').join(__dirname, '../frontend/src/user/pages/ScriptPage.jsx'), 'utf8');

const {
  materialVersion,
  buildHistoryVersionFields,
  commitRegeneration
} = require('../lib/script-generation/history-versioning.cjs');

test('material edits increment version and history keeps material/source/output versions', () => {
  assert.equal(materialVersion({ version: 1 }, { characters: [{ id: 'c1', name: '甲' }] }), 2);
  const fields = buildHistoryVersionFields({
    material: { version: 2, characters: [{ id: 'c1', name: '乙' }] },
    sourceText: '原文', output: '新输出', previousOutputId: 'hist-old'
  });
  assert.equal(fields.materialVersion, 2);
  assert.equal(fields.material.characters[0].name, '乙');
  assert.equal(fields.sourceText, '原文');
  assert.equal(fields.output, '新输出');
  assert.equal(fields.previousOutputId, 'hist-old');
});

test('failed regeneration preserves current successful result and history pointer', () => {
  const current = { output: '旧输出', historyId: 'hist-old' };
  assert.deepEqual(commitRegeneration(current, null, new Error('upstream')), current);
  assert.deepEqual(commitRegeneration(current, { output: '新输出', historyId: 'hist-new' }), { output: '新输出', historyId: 'hist-new' });
});

test('markdown is an import/export boundary, never the authority', () => {
  const fields = buildHistoryVersionFields({ output: 'x', markdown: '# x' });
  assert.equal(fields.markdown, undefined);
  assert.equal(fields.output, 'x');
});

test('generation payload uses current material and only adds previous output on regeneration', () => {
  assert.match(pageSource, /generateScript\(\{[\s\S]*?material: extractInfo/);
  assert.match(pageSource, /regenerate && previousOutput \? \{ previousOutput \}/);
  assert.match(pageSource, /entry\.material \|\| entry\.extractInfo/);
  assert.match(pageSource, /previousOutputId: regenerate \? previousHistoryId/);
});
