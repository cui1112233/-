import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');

test('replaces a typed @ token through one image-aware menu instead of a fixed candidate strip', () => {
  assert.match(page, /import \{ MentionAssetMenu \} from '..\/components\/ScriptMentionAssetMenu';/);
  assert.match(page, /findMentionTarget\(input, nextOutput\)/);
  assert.match(page, /onSelect=\{asset => insertOutputMention\(asset\.name\)\}/);
  assert.match(page, /onCreate=\{\(type, name\) => addEntity\(type, name\)\}/);
  assert.doesNotMatch(page, /outputMentionCandidates\(extractInfo\.characters\)/);
});

test('opens the existing asset editor with the typed @ name prefilled', () => {
  assert.match(page, /function addEntity\(type, initialName = ''\)/);
  assert.match(page, /名称: initialName/);
  assert.match(page, /onAddImage=\{asset => openEntityEditor\(asset\.type, asset\.id\)\}/);
});
