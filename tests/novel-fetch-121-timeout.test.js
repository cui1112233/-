const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('121 login hotfix keeps frontend timeout above backend verification window', () => {
  const source = read('frontend/public/batch-rewrite/121-login-hotfix.js');
  assert.match(source, /REQUEST_TIMEOUT_MS\s*=\s*35_000/);
  assert.match(source, /REQUEST_TIMEOUT_SECONDS\s*=\s*Math\.ceil\(REQUEST_TIMEOUT_MS\s*\/\s*1000\)/);
  assert.match(source, /请求超时（\$\{REQUEST_TIMEOUT_SECONDS\} 秒）/);
});

test('121 dashboard verification gets at least a 30 second HTTP window', () => {
  const source = read('lib/target-upload.js');
  assert.match(source, /TARGET_CHECK_TIMEOUT_MS\s*=\s*30_000/);
  assert.match(source, /parsed\.pathname\s*===\s*TARGET_CHECK_PATH/);
  assert.match(source, /Math\.max\(TARGET_CHECK_TIMEOUT_MS,/);
  assert.match(source, /req\.setTimeout\(effectiveTimeoutMs,/);
});
