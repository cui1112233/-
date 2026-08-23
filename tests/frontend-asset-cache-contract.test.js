const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hashed frontend assets use immutable caching while workbench pages remain refreshable', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const assets = app.slice(app.indexOf("app.use('/assets'"), app.indexOf("app.use('/batch-rewrite'"));
  const workbench = app.slice(app.indexOf("app.use('/batch-rewrite'"), app.indexOf("app.use('/pets'"));
  assert.match(assets, /max-age=31536000, immutable/);
  assert.doesNotMatch(assets, /no-store/);
  assert.match(workbench, /no-store/);
});
