const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scriptPage = fs.readFileSync(path.join(root, 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'src', 'shared', 'styles', 'global.css'), 'utf8');

test('script empty state exposes themed light-card structure', () => {
  assert.match(scriptPage, /className="script-empty legacy-panel-card"/);
  assert.match(scriptPage, /className="script-empty-card"/);
  assert.match(scriptPage, /className="script-empty-dot" aria-hidden="true"/);
  assert.match(scriptPage, /className="script-empty-ray" aria-hidden="true"/);
  assert.match(scriptPage, /className="script-empty-line script-empty-line--top" aria-hidden="true"/);
  assert.match(scriptPage, /className="script-empty-title">准备创作</);
  assert.match(scriptPage, /className="script-empty-copy">先提取人物与场景，确认后再生成剧本</);
});

test('script empty state has responsive themed motion styles', () => {
  assert.match(css, /\.script-empty\s*\{[^}]*width:\s*min\(100%,\s*420px\)/s);
  assert.match(css, /\.script-empty\s*\{[^}]*min-height:\s*220px/s);
  assert.match(css, /@keyframes\s+script-empty-move-dot/);
  assert.match(css, /\.script-empty-dot\s*\{[^}]*animation:\s*script-empty-move-dot/s);
  assert.match(css, /\[data-theme='light'\][\s\S]*?\.script-empty-card/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.script-empty-dot\s*\{[^}]*animation:\s*none/s);
});
