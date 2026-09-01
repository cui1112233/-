const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const pageEntryPath = path.join(root, 'frontend', 'src', 'user', 'pages', 'BatchFactoryPage.jsx');
const v11Root = path.join(root, 'frontend', 'src', 'user', 'pages', 'batch-factory-v11');
const v11ApiPath = path.join(root, 'frontend', 'src', 'shared', 'api', 'batchFactoryV11.js');

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.name.endsWith('.test.js') ? [] : /\.(?:js|jsx)$/.test(entry.name) ? [target] : [];
  });
}

test('the candidate batch-factory entry renders V11 instead of the old preview page', () => {
  const source = fs.readFileSync(pageEntryPath, 'utf8');
  assert.match(source, /BatchFactoryV11UiPage/);
  assert.doesNotMatch(source, /BatchFactoryPreviewPage/);
});

test('V11 source stays on its own API namespace and has an adapter', () => {
  assert.equal(fs.existsSync(v11ApiPath), true, 'missing frontend/src/shared/api/batchFactoryV11.js');
  const files = [...sourceFiles(v11Root), v11ApiPath];
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /shared\/api\/batchFactory(?:['"`]|$)/, `${file} imports legacy Batch Factory client`);
    const paths = [...source.matchAll(/\/api\/batch-factory\/[^\s'"`)]+/g)].map(match => match[0]);
    for (const apiPath of paths) {
      assert.equal(apiPath.startsWith('/api/batch-factory/v11'), true, `${file} contains legacy API path ${apiPath}`);
    }
  }
});
