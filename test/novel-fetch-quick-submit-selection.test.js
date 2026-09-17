const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('quick submit preserves checked task ids', () => {
  const source = read('public/batch-rewrite/v78-quick-submit-selection-hotfix.js');
  assert.match(source, /task-check:checked/);
  assert.match(source, /qiantieSubmitSelectedTasks/);
});
