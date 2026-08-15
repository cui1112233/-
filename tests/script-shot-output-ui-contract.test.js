const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('shot card component provides individual, selected and all-copy controls', () => {
  const cards = read('frontend/src/user/components/ShotOutputCards.jsx');
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(cards, /复制本分镜/);
  assert.match(cards, /复制已选/);
  assert.match(cards, /全选/);
  assert.match(cards, /Checkbox/);
  assert.match(page, /ShotOutputCards/);
});

test('script page uses card output only for parsed non-shortdrama results', () => {
  const cards = read('frontend/src/user/components/ShotOutputCards.jsx');
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /getShotCards\(selectedFormat, output\)/);
  assert.match(page, /shotCards\.length/);
  assert.match(page, /setEditingOutput\(true\)/);
  assert.match(page, /joinShotCards/);
  assert.match(cards, /分镜 \{index \+ 1\} · \{cardDuration\}/);
  assert.match(page, /duration=\{form\.getFieldValue\('duration'\)\}/);
  assert.match(page, /onCopy=\{copyText\}/);
});

test('script page provides find and replace only for selected shot cards', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /查找替换/);
  assert.match(page, /selectedShotIndexes\.size/);
  assert.match(page, /getSelectedShotMatches/);
  assert.match(page, /replaceSelectedShotMatch/);
  assert.match(page, /replaceAllSelectedShotMatches/);
  assert.match(page, /updateOutputDraft\(nextOutput\)/);
  assert.match(page, /Modal/);
});
