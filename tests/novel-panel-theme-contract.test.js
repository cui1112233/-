const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stylePath = path.join(root, 'public', 'novel-panel', 'workbench', 'style.css');
const appPath = path.join(root, 'public', 'novel-panel', 'workbench', 'app.js');

test('novel-panel workbench defines complete self-contained theme tokens', () => {
  const css = fs.readFileSync(stylePath, 'utf8');

  assert.match(css, /:root\s*\{/);
  assert.match(css, /--bg:/);
  assert.match(css, /--surface:/);
  assert.match(css, /--muted:/);
  assert.match(css, /--line:/);
  assert.match(css, /--warning:/);
  assert.match(css, /--success:/);
  assert.match(css, /--warning-soft:/);
});

test('novel-panel feature pages and dynamic notices keep their themed surfaces', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');

  assert.match(css, /\.instruction-center-page\s*\{[^}]*background:\s*#f5f7fb/s);
  assert.match(css, /\.history-page\s*\{[^}]*background:\s*#f5f7fb/s);
  assert.match(css, /\.relationship-graph-panel\s*\{[^}]*border:\s*1px solid var\(--border,\s*#d9dee8\)/s);
  assert.match(css, /\.soft-warning\s*\{[^}]*background:\s*var\(--warning-soft\)/s);
});
