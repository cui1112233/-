import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./InlineMentionEditor.jsx', import.meta.url), 'utf8');

test('renders image mentions as atomic inline labels and serializes canonical text', () => {
  assert.match(source, /contentEditable={false}/);
  assert.match(source, /data-mention-name/);
  assert.match(source, /serializeInlineMentionRoot/);
  assert.match(source, /useImperativeHandle/);
});
