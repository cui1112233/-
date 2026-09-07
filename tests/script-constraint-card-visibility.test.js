const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pagePath = path.join(repoRoot, 'frontend/src/user/pages/ScriptPage.jsx');
const finalSegmentPath = path.join(repoRoot, 'frontend/src/user/pages/scriptFinalSegment.js');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('nonstandard model output still enters final storyboard card assembly', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const rawCardsBlock = sourceBetween(page, 'const rawShotCards = useMemo(() => {', 'const shotCards = useMemo');

  assert.match(rawCardsBlock, /getShotCardsWithinDuration/,
    'standard ### 分镜N output should remain the preferred parser');
  assert.match(rawCardsBlock, /parsed\.length/,
    'the page must inspect whether the strict parser produced cards');
  assert.match(rawCardsBlock, /output\s*\?\s*\[output\]/,
    'when AI output exists but lacks a standard outer heading, it must still become one display card so final constraint assembly can run');
});

test('saving constraint switches immediately recomposes current storyboard cards', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const cardAssemblyBlock = sourceBetween(page, 'const shotCards = useMemo', 'const shotCardStarts = useMemo');

  assert.match(cardAssemblyBlock, /constraintsForFormat\(constraints,\s*selectedFormat,\s*extractInfo\)/,
    'visible cards must use the current saved constraints so switches update immediately without another AI request');
  assert.doesNotMatch(cardAssemblyBlock, /constraintsForFormat\(outputConstraints,/,
    'visible card assembly must not be frozen to the generation-time constraint snapshot');
});

test('final card assembler owns every visible constraint layer', () => {
  const source = fs.readFileSync(finalSegmentPath, 'utf8');

  assert.match(source, /constraints\?\.baseSetup\?\.enabled === true/);
  assert.match(source, /【基础设定】/);
  assert.match(source, /【画面前缀】/);
  assert.match(source, /【画质约束】/);
  assert.match(source, /negativeConstraint/);
  assert.match(source, /负面提示词/);
});
