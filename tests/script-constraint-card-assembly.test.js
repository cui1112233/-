const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(
  path.join(__dirname, '..', 'frontend/src/user/pages/ScriptPage.jsx'),
  'utf8'
);

function cardAssemblyBlock() {
  const start = page.indexOf('const shotCards = useMemo');
  const end = page.indexOf('const shotCardStarts = useMemo', start);
  assert.notEqual(start, -1, 'shot-card assembly must exist');
  assert.notEqual(end, -1, 'shot-card start calculation must follow assembly');
  return page.slice(start, end);
}

test('visible storyboard cards preserve the constraints used for the current output', () => {
  const block = cardAssemblyBlock();

  assert.match(
    block,
    /constraintsForFormat\(outputConstraints,\s*selectedFormat,\s*extractInfo\)/,
    'the current output snapshot must feed visible card assembly'
  );
  assert.doesNotMatch(
    block,
    /constraintsForFormat\(constraints,/,
    'next-generation state must not hide the constraints used by the current output'
  );
  assert.match(
    block,
    /\[rawShotCards, extractInfo, outputConstraints, selectedFormat, selectedDuration\]/,
    'the visible card memo must follow the current output snapshot'
  );
});

test('saving constraints refreshes the current output snapshot for an already visible result', () => {
  assert.match(
    page,
    /function saveConstraints\(\)[\s\S]*?setConstraints\(next\);[\s\S]*?setOutputConstraints\(next\);/,
    'saving a setting after generation must refresh the visible card snapshot'
  );
});
