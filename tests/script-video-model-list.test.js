const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPage = fs.readFileSync(path.resolve(__dirname, '../frontend/src/user/pages/ScriptPage.jsx'), 'utf8');

test('script video model list keeps H3 selectable when the legacy public catalog omits it', () => {
  assert.match(scriptPage, /withH3ScriptVideoModel/);
  assert.match(scriptPage, /Promise\.allSettled\(\[listModels\(\), getConfig\(\)\]\)/);
  assert.match(scriptPage, /minimax-h3-video/);
});
