const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy compatibility test endpoint cannot accept caller supplied AI settings', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-rewrite.js'), 'utf8');
  const endpoint = source.match(/router\.post\('\/ai\/test',[\s\S]*?\n  router\.post\('\/rules\/preview'/);
  assert.ok(endpoint, 'expected legacy test endpoint');
  assert.doesNotMatch(endpoint[0], /req\.body\?\.settings/);
  assert.match(endpoint[0], /ai\.resolveAiSettings\(store, req\.body\?\.purpose \|\| 'classifier'\)/);
});
