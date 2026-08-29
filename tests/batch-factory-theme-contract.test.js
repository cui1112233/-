const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const themePath = path.join(root, 'frontend/src/shared/styles/theme.js');
const cssPath = path.join(root, 'frontend/src/shared/styles/global.css');

const themeSource = fs.readFileSync(themePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

test('theme uses Ant Design light and dark algorithms', () => {
  assert.match(themeSource, /defaultAlgorithm/);
  assert.match(themeSource, /darkAlgorithm/);
  assert.match(themeSource, /algorithm\s*:/);
});

test('global css does not force semantic AntD tag text colors', () => {
  assert.doesNotMatch(css, /\.user-theme-active\s+\.ant-tag\s*\{[^}]*color\s*:/s);
});

test('batch factory selected state does not rely on hard-coded Ant blue', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/user/pages/BatchFactoryPageV9.jsx'), 'utf8');
  assert.doesNotMatch(page, /#1677ff/i);
});
