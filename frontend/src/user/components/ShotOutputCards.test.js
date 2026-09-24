import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./ShotOutputCards.jsx', import.meta.url), 'utf8');

test('uses the shared visual mention display in saved cards without changing raw card actions', () => {
  assert.match(source, /import ScriptMentionDisplay from '\.\/ScriptMentionDisplay'/);
  assert.match(source, /mentionCandidates = \[\]/);
  assert.match(source, /<ScriptMentionDisplay text=\{card\} candidates=\{mentionCandidates\} highlightRange=\{displayRange\} \/>/);
  assert.match(source, /onClick=\{\(\) => onCopy\(card\)\}/);
  assert.match(source, /onClick=\{\(\) => onGenerateVideo\?\.\(card, index\)\}/);
});
