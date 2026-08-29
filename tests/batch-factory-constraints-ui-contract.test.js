const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'BatchFactoryPageV9.jsx');
const editorPath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'batch-factory', 'BatchConstraintSettings.jsx');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('production unified settings render constraints inline below a divider', () => {
  const page = source(pagePath);
  assert.match(page, /<Divider plain>约束设置<\/Divider>/);
  assert.match(page, /<BatchConstraintEditor value=\{form\}/);
  assert.doesNotMatch(page, /进入设置/);
});

test('constraint editor exposes exactly the agreed five production constraint rows', () => {
  const editor = source(editorPath);
  assert.match(editor, /基础设定（人物 \/ 场景）/);
  assert.match(editor, /label: '画面前缀词'/);
  assert.match(editor, /label: '画质约束'/);
  assert.match(editor, /label: '画面限制'/);
  assert.match(editor, /label: '负面提示词'/);
  assert.doesNotMatch(editor, /字幕限制.*enabledKey/);
});

test('current novel opens a centered constraint modal with partial override reset', () => {
  const page = source(pagePath);
  const editor = source(editorPath);
  assert.match(page, /<Button size="small" onClick=\{\(\) => setConstraintOpen\(true\)\}>约束设置<\/Button>/);
  assert.match(page, /<BatchBookConstraintModal/);
  assert.match(editor, /title="约束设置"/);
  assert.match(editor, /恢复批次设置/);
  assert.match(editor, /updateBatchFactoryItemOverrides\(batch\.id, item\.id, patch\)/);
});
