const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPage = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'),
  'utf8'
);

test('script page reads video model options from the unified catalog', () => {
  assert.match(scriptPage, /listModels/);
  assert.doesNotMatch(scriptPage, /options=\[\{ label: 'YD2\.0 Mini（图生）'/);
  assert.doesNotMatch(scriptPage, /local-doubao-executor-video' \}\]/);
});
