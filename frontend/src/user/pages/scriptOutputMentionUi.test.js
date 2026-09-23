import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');

test('the total script and shot editors use the same inline mention editor', () => {
  assert.match(source, /import ScriptMentionEditor from '\.\.\/components\/ScriptMentionEditor'/);
  assert.match(source, /<ScriptMentionEditor[\s\S]*value=\{output\}/);
  assert.match(source, /<ScriptMentionEditor[\s\S]*value=\{editingShot\.text\}/);
  assert.match(source, /selectionOffset=\{editingOutputSelection\.start\}/);
  assert.match(source, /selectionOffset=\{editingShotSelection\.start\}/);
  assert.match(source, /const mentionCandidates = useMemo/);
  assert.match(source, /candidates=\{mentionCandidates\}/);
});

test('the ScriptPage menu is cursor-anchored and shows visual asset choices without a bottom toolbar', () => {
  assert.match(source, /可能@的内容/);
  assert.match(source, /创建主体/);
  assert.match(source, /candidateImageUrl/);
  assert.match(source, /anchorRect/);
  assert.doesNotMatch(source, /aria-label="打开人物与场景素材候选"/);
  assert.doesNotMatch(source, /aria-label="当前全文已引用素材"/);
});
