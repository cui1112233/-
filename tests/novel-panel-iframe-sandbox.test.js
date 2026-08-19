const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'NovelPanelPage.jsx');

test('novel panel iframe sandbox allows same-origin storage so workbench drafts persist', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const match = source.match(/sandbox="([^"]+)"/);
  assert.ok(match, 'NovelPanelPage must render an iframe with a sandbox attribute');
  const sandbox = match[1].split(/\s+/).filter(Boolean);
  assert.ok(sandbox.includes('allow-scripts'), 'sandbox must keep allow-scripts');
  assert.ok(
    sandbox.includes('allow-same-origin'),
    'sandbox must include allow-same-origin so the workbench can use localStorage/IndexedDB for draft persistence'
  );
});
