const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stylesheetPath = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'style.css');

test('novel-panel primary buttons provide gradient, focus, motion-reduction, and semantic button contracts', () => {
  const css = fs.readFileSync(stylesheetPath, 'utf8');

  assert.match(css, /\.btn\.primary\s*\{[\s\S]*?background:\s*linear-gradient\([\s\S]*?\}/);
  assert.match(css, /\.btn\.primary\s*\{[\s\S]*?background-size:\s*200%\s+200%[\s\S]*?\}/);
  assert.match(css, /\.btn\.primary\s*\{[\s\S]*?border-radius:\s*30px[\s\S]*?\}/);
  assert.match(css, /\.btn\.primary\s*\{[\s\S]*?animation:\s*button-shimmer[\s\S]*?\}/);
  assert.match(css, /\.btn\.primary:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--button-focus\)[\s\S]*?\}/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.btn\.primary\s*\{[\s\S]*?animation:\s*none[\s\S]*?\}/);
  assert.match(css, /\.btn\.secondary\s*\{[\s\S]*?background:\s*var\(--surface\)[\s\S]*?\}/);
  assert.match(css, /\.btn\.danger\s*\{[\s\S]*?background:\s*var\(--danger-soft\)[\s\S]*?\}/);
});
