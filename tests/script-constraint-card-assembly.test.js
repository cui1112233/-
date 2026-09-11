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

test('visible storyboard cards recompose from current saved constraints', () => {
  const block = cardAssemblyBlock();

  assert.match(
    block,
    /constraintsForFormat\(constraints,\s*selectedFormat,\s*extractInfo\)/,
    'current saved constraint switches must feed visible card assembly'
  );
  assert.doesNotMatch(
    block,
    /constraintsForFormat\(outputConstraints,/,
    'generation-time snapshot must not hide newly saved constraints from visible cards'
  );
  assert.match(
    block,
    /\[rawShotCards, extractInfo, constraints, selectedFormat, selectedDuration\]/,
    'saving constraints must invalidate the visible card memo'
  );
});
