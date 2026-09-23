import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');

test('replaces a typed @ token through one image-aware menu instead of a fixed candidate strip', () => {
  assert.match(page, /import \{ MentionAssetMenu \} from '..\/components\/ScriptMentionAssetMenu';/);
  assert.match(page, /import \{ InlineMentionEditor \} from '..\/components\/InlineMentionEditor';/);
  assert.match(page, /outputEditorRef\.current\?\.replaceTarget\(outputMention, asset\)/);
  assert.match(page, /shotEditorRef\.current\?\.replaceTarget\(shotMention, asset\)/);
  assert.match(page, /onCreate=\{\(type, name\) => \{ setOutputMention\(null\); addEntity\(type, name\); \}\}/);
  assert.doesNotMatch(page, /outputMentionCandidates\(extractInfo\.characters\)/);
});

test('opens the existing asset editor with the typed @ name prefilled', () => {
  assert.match(page, /function addEntity\(type, initialName = ''\)/);
  assert.match(page, /名称: initialName/);
  assert.match(page, /onAddImage=\{asset => \{ setOutputMention\(null\); openEntityEditor\(asset\.type, asset\.id\); \}\}/);
});
