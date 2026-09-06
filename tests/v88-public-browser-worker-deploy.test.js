const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('V88 public compose overlay connects Novel Fetch to the existing 121 Browser Worker', () => {
  const compose = read('deploy/v88-public/docker-compose.browser-worker.yml');

  assert.match(compose, /novel-fetch-121-worker:/);
  assert.match(compose, /v88-node:/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL:\s*http:\/\/novel-fetch-121-worker:8787/);
  assert.ok((compose.match(/\.\/novel-fetch-121\.env/g) || []).length >= 2, 'both v88-node and Browser Worker must load the shared secret env file');
  assert.match(compose, /v88-public-novel-fetch-121-worker:v88-latest/);
  assert.doesNotMatch(compose, /ports:\s*[\s\S]{0,120}8787/);
});

test('V88 public release workflow builds and deploys the existing 121 Browser Worker beside v88-node', () => {
  const workflow = read('.github/workflows/v88-linux-amd64-image-release.yml');

  assert.match(workflow, /services\/121-browser-worker\/\*\*/);
  assert.match(workflow, /services\/121-browser-worker/);
  assert.match(workflow, /docker-compose\.browser-worker\.yml/);
  assert.match(workflow, /novel-fetch-121\.env/);
  assert.match(workflow, /ensure_secret QIANTIE_121_WORKER_SECRET/);
  assert.match(workflow, /ensure_secret QIANTIE_121_CREDENTIAL_SECRET/);
  assert.match(workflow, /ensure_secret QIANTIE_121_STORAGE_STATE_SECRET/);
  assert.match(workflow, /novel-fetch-121-worker/);
  assert.match(workflow, /docker compose[^\n]*-f docker-compose\.yml[^\n]*-f docker-compose\.browser-worker\.yml/);
});
