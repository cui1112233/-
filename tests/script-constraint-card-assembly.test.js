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

test('visible storyboard cards follow the currently saved constraints', () => {
  const block = cardAssemblyBlock();

  assert.match(
    block,
    /constraintsForFormat\(constraints,\s*selectedFormat,\s*extractInfo\)/,
    'the current saved base setup must feed visible card assembly'
  );
  assert.doesNotMatch(
    block,
    /constraintsForFormat\(outputConstraints,/,
    'a generation-time snapshot must not hide a newly saved base setup'
  );
  assert.match(
    block,
    /\[rawShotCards, extractInfo, constraints, selectedFormat, selectedDuration\]/,
    'the visible card memo must follow the current saved constraints'
  );
});

test('saving constraints still records the output snapshot for draft and history recovery', () => {
  assert.match(
    page,
    /function saveConstraints\(\)[\s\S]*?setConstraints\(next\);[\s\S]*?setOutputConstraints\(next\);/,
    'saving a setting after generation must refresh the visible card snapshot'
  );
});
