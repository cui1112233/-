const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPage = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'),
  'utf8'
);

test('script output copy falls back when Clipboard API is unavailable', () => {
  assert.match(scriptPage, /document\.execCommand\('copy'\)/);
  assert.doesNotMatch(scriptPage, /if \(!text \|\| !navigator\.clipboard\?\.writeText\) return message\.warning\('当前环境不支持复制'\)/);
});
