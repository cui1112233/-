import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');
const editor = source.slice(source.indexOf('function EntityEditor('));

test('opening the entity editor does not call removed image state setters', () => {
  assert.doesNotMatch(editor, /setGeneratingImage\(|setUploadingImage\(|setImageGenerationError\(/);
});
