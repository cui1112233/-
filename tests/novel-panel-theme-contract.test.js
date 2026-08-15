const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stylePath = path.join(root, 'public', 'novel-panel', 'workbench', 'style.css');
const appPath = path.join(root, 'public', 'novel-panel', 'workbench', 'app.js');

test('novel-panel workbench defines complete dark theme tokens', () => {
  const css = fs.readFileSync(stylePath, 'utf8');

  assert.match(css, /\[data-theme=['"]dark['"]\]/);
  assert.match(css, /--surface-field:/);
  assert.match(css, /--surface-field-alt:/);
  assert.match(css, /--line-strong:/);
  assert.match(css, /--warning-border:/);
});

test('novel-panel feature pages and dynamic notices use theme tokens', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');

  assert.match(css, /\.instruction-center-page\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.match(css, /\.history-page\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.match(css, /\.relationship-graph-panel\s*\{[^}]*border:\s*1px solid var\(--line\)/s);
  assert.match(css, /\.cast-source-tag\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(css, /\.soft-warning,\s*\.v43-character-result-banner,\s*\.v44-character-isolation-banner\s*\{[^}]*background:\s*var\(--warning-soft\)/s);
  assert.doesNotMatch(css, /var\(--border,\s*#d9dee8\)/);
  assert.doesNotMatch(app, /sourceTag\.style\.color\s*=/);
  assert.doesNotMatch(app, /banner\.style\.cssText\s*=/);
});
