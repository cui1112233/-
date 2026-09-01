const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('121 Browser Worker image pins Playwright 1.55 and provides Xvfb for true headed checks', () => {
  const root = path.join(__dirname, '..', 'services', '121-browser-worker');
  const source = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'start-worker.sh'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(source, /mcr\.microsoft\.com\/playwright:v1\.55\.0/);
  assert.match(source, /npm install --omit=dev/);
  assert.match(source, /COPY start-worker\.sh \.\//);
  assert.match(source, /CMD \["\.\/start-worker\.sh"\]/);
  assert.match(launcher, /Xvfb/);
  assert.match(launcher, /DISPLAY/);
  assert.match(launcher, /wait/);
  assert.equal(pkg.dependencies.playwright, '1.55.0');
  assert.equal(pkg.dependencies.express, '4.21.2');
  assert.doesNotMatch(source, /qiantie-platform/);
});
