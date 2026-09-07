const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('active 121 Browser Worker timeout hierarchy lets inner layers report first', () => {
  const frontend = read('frontend/public/batch-rewrite/121-login-hotfix.js');
  const client = read('lib/novel-fetch-workshop/121-browser-client.js');
  const worker = read('services/121-browser-worker/src/server.js');
  const compose = read('deploy/v88-public/docker-compose.browser-worker.yml');

  assert.match(frontend, /REQUEST_TIMEOUT_MS\s*=\s*65_000/);
  assert.match(frontend, /REQUEST_TIMEOUT_SECONDS\s*=\s*Math\.ceil\(REQUEST_TIMEOUT_MS\s*\/\s*1000\)/);
  assert.match(frontend, /请求超时（\$\{REQUEST_TIMEOUT_SECONDS\} 秒）/);

  assert.match(client, /timeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_CLIENT_TIMEOUT_MS\)\s*\|\|\s*40_000/);
  assert.match(client, /loginTimeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_CLIENT_LOGIN_TIMEOUT_MS\)\s*\|\|\s*55_000/);
  assert.match(worker, /verifyTimeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_VERIFY_TIMEOUT_MS\)\s*\|\|\s*30_000/);
  assert.match(worker, /loginTimeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_LOGIN_TIMEOUT_MS\)\s*\|\|\s*45_000/);

  assert.match(compose, /QIANTIE_121_CLIENT_TIMEOUT_MS:\s*["']40000["']/);
  assert.match(compose, /QIANTIE_121_CLIENT_LOGIN_TIMEOUT_MS:\s*["']55000["']/);
  assert.match(compose, /QIANTIE_121_VERIFY_TIMEOUT_MS:\s*["']30000["']/);
  assert.match(compose, /QIANTIE_121_LOGIN_TIMEOUT_MS:\s*["']45000["']/);
});

test('legacy 121 dashboard compatibility path still gets at least a 30 second HTTP window', () => {
  const source = read('lib/target-upload.js');
  assert.match(source, /TARGET_CHECK_TIMEOUT_MS\s*=\s*30_000/);
  assert.match(source, /parsed\.pathname\s*===\s*TARGET_CHECK_PATH/);
  assert.match(source, /Math\.max\(TARGET_CHECK_TIMEOUT_MS,/);
  assert.match(source, /req\.setTimeout\(effectiveTimeoutMs,/);
});
