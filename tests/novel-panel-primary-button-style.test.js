const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stylesheetPath = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'style.css');

test('novel-panel primary, secondary, and danger buttons keep their semantic color contract', () => {
  const css = fs.readFileSync(stylesheetPath, 'utf8');

  assert.match(css, /\.btn\.primary\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(css, /\.btn\.primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--primary-dark\)/s);
  assert.match(css, /\.btn\.secondary\s*\{[^}]*background:\s*#fff/s);
  assert.match(css, /\.btn\.danger\s*\{[^}]*background:\s*var\(--danger-soft\)/s);
  assert.match(css, /--primary:/);
  assert.match(css, /--danger-soft:/);
});
