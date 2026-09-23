import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');

test('the full-script editor wires @ mentions to the cursor-aware mention helpers', () => {
  assert.match(source, /const \[editingOutputSelection, setEditingOutputSelection\] = useState\(\{ start: 0, end: 0 \}\)/);
  assert.match(source, /const activeOutputMention = useMemo/);
  assert.match(source, /function insertOutputMention\(candidate\)/);
  assert.match(source, /placeholder="任意位置输入 @ 选择人物或场景，也可直接输入 @名称"/);
  assert.match(source, /insertOutputMention\(activeOutputMentionCandidates\[outputMentionActiveIndex\]/);
});

test('the full-script editor exposes a visible @ asset entry and reference tags', () => {
  assert.match(source, /aria-label="打开人物与场景素材候选"/);
  assert.match(source, />@ 素材<\/Button>/);
  assert.match(source, /aria-label="当前全文已引用素材"/);
});
