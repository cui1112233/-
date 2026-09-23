const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('serves the creative drama client route through the React entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pages.js'), 'utf8');

  assert.match(
    source,
    /router\.get\('\/shuihuo-production\/creative', serveReactEntry\('index\.html', 'index\.html'\)\);/
  );
});
