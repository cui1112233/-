import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('./ScriptMentionEditor.jsx', import.meta.url);

test('declares an editable surface and non-editable visual mention chips', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /contentEditable=\{editable\}/);
  assert.match(source, /chip\.contentEditable = 'false'/);
  assert.match(source, /buildInlineMentionSegments\(value, candidates\)/);
  assert.match(source, /image\.loading = 'lazy'/);
  assert.match(source, /script-mention-editor/);
  assert.match(source, /getClientRects\(\)/);
  assert.match(source, /chip\.dataset\.mentionValue/);
});

test('wires composition and plain-text paste guards into the editor surface', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /onCompositionStart/);
  assert.match(source, /onCompositionEnd/);
  assert.match(source, /clipboardData\.getData\('text\/plain'\)/);
});

test('renders editable children outside React reconciliation', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /useLayoutEffect/);
  assert.match(source, /root\.replaceChildren/);
  assert.doesNotMatch(source, /\{segments\.map\(/);
});

test('captures the @ query cursor before a parent output update can redraw the editor', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /const cursor = selectionOffset\(root\);\s*const rect = selectionRect\(root\);\s*restoreOffsetRef\.current = cursor;\s*onChange\?\.\(text\);\s*onQueryChange\?\.\(\{ text, cursor, rect \}\)/s);
});
