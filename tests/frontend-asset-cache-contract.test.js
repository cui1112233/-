const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('hashed frontend assets stay immutable while batch-rewrite stays no-store', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const assets = app.slice(app.indexOf("app.use('/assets'"), app.indexOf("app.use('/batch-rewrite'"));
  const batchRewrite = app.slice(app.indexOf("app.use('/batch-rewrite'"), app.indexOf("app.use('/pets'"));

  assert.match(assets, /public, max-age=31536000, immutable/);
  assert.doesNotMatch(assets, /no-store/);
  assert.match(batchRewrite, /no-store, no-cache, must-revalidate, proxy-revalidate/);
  assert.doesNotMatch(batchRewrite, /immutable/);
});
