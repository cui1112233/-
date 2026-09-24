import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./InlineMentionEditor.jsx', import.meta.url), 'utf8');

test('renders image mentions as atomic inline labels and serializes canonical text', () => {
  assert.match(source, /mention\.contentEditable = 'false'/);
  assert.match(source, /mention\.dataset\.mentionName/);
  assert.match(source, /serializeInlineMentionRoot/);
  assert.match(source, /useImperativeHandle/);
});

test('keeps long documents inside the editor while typing and commits on blur', () => {
  const inputHandler = source.match(/function handleInput\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(inputHandler, /onChange\?\./);
  assert.match(source, /function commitDraft\(\)/);
  assert.match(source, /onBlur=\{commitDraft\}/);
});

test('lets the browser own the editable DOM to avoid React child removal failures', () => {
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /root\.replaceChildren/);
  assert.doesNotMatch(source, /\{nodes\.map\(/);
});
