const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('script exposes account-scoped reference asset generation and upload clients', () => {
  const clientPath = path.join(root, 'frontend/src/shared/api/novelPanel.js');
  assert.equal(fs.existsSync(clientPath), true);
  const source = read('frontend/src/shared/api/novelPanel.js');
  assert.match(source, /reference-assets\/generate/);
  assert.match(source, /reference-assets\/upload/);
  assert.doesNotMatch(source, /apiKey|api_key|Authorization/);
});
