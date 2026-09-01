const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('121 Browser Worker image pins Playwright 1.55 and provides Xvfb for true headed checks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', '121-browser-worker', 'Dockerfile'), 'utf8');
  assert.match(source, /mcr\.microsoft\.com\/playwright:v1\.55\.0/);
  assert.match(source, /npm install --omit=dev/);
  assert.match(source, /xvfb-run -a node src\/server\.js/);
  assert.doesNotMatch(source, /qiantie-platform/);
});
