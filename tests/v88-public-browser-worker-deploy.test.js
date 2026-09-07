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
  assert.match(compose, /novel-fetch-121-data:\/data/);
  assert.match(compose, /volumes:\s*\n\s+novel-fetch-121-data:/);
  assert.doesNotMatch(compose, /ports:\s*[\s\S]{0,120}8787/);
});

test('V88 public release workflow builds and deploys the existing 121 Browser Worker beside v88-node', () => {
  const workflow = read('.github/workflows/v88-linux-amd64-image-release.yml');

  assert.match(workflow, /services\/121-browser-worker\/\*\*/);
  assert.match(workflow, /docker build[^\n]*services\/121-browser-worker/);
  assert.match(workflow, /docker-compose\.browser-worker\.yml/);
  assert.match(workflow, /novel-fetch-121\.env/);
  assert.match(workflow, /ensure_secret QIANTIE_121_WORKER_SECRET/);
  assert.match(workflow, /ensure_secret QIANTIE_121_CREDENTIAL_SECRET/);
  assert.match(workflow, /ensure_secret QIANTIE_121_STORAGE_STATE_SECRET/);
  assert.match(workflow, /novel-fetch-121-worker/);
  assert.match(workflow, /compose=\(docker compose -f "\$compose_file" -f "\$compose_dir\/docker-compose\.browser-worker\.yml"\)/);
  assert.match(workflow, /"\$\{compose\[@\]\}" config/);
  assert.match(workflow, /QIANTIE_121_BROWSER_WORKER_URL/);
  assert.match(workflow, /\/healthz/);
});

test('V88 deployment attaches the new Browser Worker to every existing v88-node Docker network before recreating v88-node', () => {
  const workflow = read('.github/workflows/v88-linux-amd64-image-release.yml');
  const deployStart = workflow.indexOf('- name: Deploy verified images to V88 ECS');
  const verifyStart = workflow.indexOf('- name: Verify V88 ECS deployment');
  assert.ok(deployStart >= 0 && verifyStart > deployStart, 'must find V88 ECS deploy step');
  const deploy = workflow.slice(deployStart, verifyStart);

  assert.match(deploy, /node_networks=.*NetworkSettings\.Networks/);
  assert.match(deploy, /docker network connect --alias novel-fetch-121-worker/);

  const connectIndex = deploy.indexOf('docker network connect --alias novel-fetch-121-worker');
  const recreateNodeIndex = deploy.indexOf('up -d --no-deps --force-recreate --pull never v88-node');
  assert.ok(connectIndex >= 0, 'Browser Worker must be connected to v88-node networks');
  assert.ok(recreateNodeIndex > connectIndex, 'network bridge must be ready before v88-node is recreated');
});
