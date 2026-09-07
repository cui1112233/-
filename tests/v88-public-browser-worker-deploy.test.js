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
  assert.match(compose, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET\}/);
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
  assert.match(workflow, /docker compose --env-file "\$compose_dir\/novel-fetch-121\.env" -f "\$compose_file" -f "\$compose_dir\/docker-compose\.browser-worker\.yml"/);
  assert.match(workflow, /docker-compose\.release-images\.yml/);
  assert.match(workflow, /"\$\{compose\[@\]\}" config/);
  assert.match(workflow, /QIANTIE_121_BROWSER_WORKER_URL/);
  assert.match(workflow, /\/healthz/);
});

test('V88 release verification identifies exact deployed images without calling protected Novel Panel build-info', () => {
  const workflow = read('.github/workflows/v88-linux-amd64-image-release.yml');
  const verifyStart = workflow.indexOf('- name: Verify V88 ECS deployment');
  const rollbackStart = workflow.indexOf('- name: Rollback V88 ECS on failed verification');
  assert.ok(verifyStart >= 0 && rollbackStart > verifyStart, 'must find verify and rollback steps');
  const verify = workflow.slice(verifyStart, rollbackStart);

  assert.doesNotMatch(verify, /\/api\/novel-panel\/build-info/, 'verify step must not anonymously call the protected Novel Panel build-info endpoint');
  assert.match(verify, /GHCR_IMAGE/, 'verify step must carry the commit-specific GHCR image');
  assert.match(verify, /WORKER_GHCR_IMAGE/, 'verify step must carry the commit-specific Browser Worker image');
  assert.match(verify, /docker image inspect[^\n]*expected_node_image[^\n]*\.Id/, 'verify step must resolve the expected main image ID');
  assert.match(verify, /docker image inspect[^\n]*expected_worker_image[^\n]*\.Id/, 'verify step must resolve the expected worker image ID');
  assert.match(verify, /docker inspect[^\n]*node_id[^\n]*\.Image/, 'verify step must read the running Node container image ID');
  assert.match(verify, /docker inspect[^\n]*worker_id[^\n]*\.Image/, 'verify step must read the running Worker container image ID');
  assert.match(verify, /expected_node_image_id/, 'verify step must compare the expected main image ID');
  assert.match(verify, /expected_worker_image_id/, 'verify step must compare the expected worker image ID');
  assert.match(verify, /actual_node_image/, 'verify step must compare Node Config.Image to the immutable ref');
  assert.match(verify, /actual_worker_image/, 'verify step must compare Worker Config.Image to the immutable ref');
  assert.match(verify, /\/api\/build-info/, 'verify step should keep the public generic build-info endpoint as HTTP liveness');
  assert.match(verify, /batch-rewrite\/interaction-feedback\.js/);
  assert.match(verify, /batch-rewrite\/task-visibility-hotfix\.js/);
  assert.match(verify, /\/novel-panel/);
});
