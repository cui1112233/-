const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'app.js');

function loadNormalizer() {
  const source = fs.readFileSync(appPath, 'utf8');
  const match = source.match(/function normalizeRepeatedScenePrefix\(value = ""\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'normalizeRepeatedScenePrefix must exist');
  const context = { text: value => String(value ?? '').trim() };
  vm.runInNewContext(`${match[0]}; globalThis.normalize = normalizeRepeatedScenePrefix;`, context);
  return context.normalize;
}

test('collapses repeated and mixed time prefixes in generated scene prompts', () => {
  const normalize = loadNormalizer();

  assert.equal(
    normalize('在夜间的夜间的夜间的夜晚韩盛家客厅，韩盛抬眼看向门口'),
    '在夜晚韩盛家客厅，韩盛抬眼看向门口'
  );
  assert.equal(
    normalize('在白昼的白昼的白昼的韩盛家客厅，韩盛攥紧手机'),
    '在白昼的韩盛家客厅，韩盛攥紧手机'
  );
  assert.equal(
    normalize('在夜间的夜晚赛声家，门缝透出冷光'),
    '在夜晚赛声家，门缝透出冷光'
  );
});
