import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('./ScriptMentionEditor.jsx', import.meta.url);

test('declares an editable surface and non-editable visual mention chips', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /contentEditable=\{editable\}/);
  assert.match(source, /contentEditable=\{false\}/);
  assert.match(source, /buildInlineMentionSegments\(value, candidates\)/);
  assert.match(source, /loading="lazy"/);
});

test('wires composition and plain-text paste guards into the editor surface', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /onCompositionStart/);
  assert.match(source, /onCompositionEnd/);
  assert.match(source, /clipboardData\.getData\('text\/plain'\)/);
});
