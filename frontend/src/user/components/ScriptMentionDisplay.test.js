import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('./ScriptMentionDisplay.jsx', import.meta.url);

test('renders saved mentions with the same candidate image data used by the editor', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /buildInlineMentionSegments\(text, candidates\)/);
  assert.match(source, /data-mention-display/);
  assert.match(source, /segment\.imageUrl/);
  assert.match(source, /@\{segment\.name\}/);
});

test('keeps visual rendering separate from the raw saved prompt text', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /export default function ScriptMentionDisplay\(\{ text, candidates, highlightRange \}\)/);
  assert.doesNotMatch(source, /onChange|contentEditable/);
});
