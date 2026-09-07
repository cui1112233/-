const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'v88-linux-amd64-image-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

const deployMarker = '- name: Deploy verified images to V88 ECS';
const verifyMarker = '- name: Verify V88 ECS deployment';
const rollbackMarker = '- name: Rollback V88 ECS on failed verification';

assert.ok(workflow.includes('name: V88 Linux AMD64 Public Image Release'));
assert.ok(workflow.includes('branches:\n      - v88'));
assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
assert.match(workflow, /IMAGE_PLATFORM:\s*linux\/amd64/);
assert.match(workflow, /ECS_HOST:\s*115\.190\.156\.223/);
assert.match(workflow, /ECS_USER:\s*root/);
assert.match(workflow, /docker build --platform "\$IMAGE_PLATFORM"/);
assert.match(workflow, /docker image inspect --format '\{\{\.Os\}\}\/\{\{\.Architecture\}\}'/);
assert.match(workflow, /qiantie-v88-linux-amd64-\$\{SHORT_SHA\}\.tar\.gz/);
assert.match(workflow, /V88_ECS_SSH_PRIVATE_KEY/,
  'release must use the configured V88 ECS SSH secret');
assert.match(workflow, /ssh-keyscan/,
  'release must pin the ECS host key before deploy');
assert.match(workflow, /docker compose -f "\$compose_file" config/,
  'preflight must validate the real ECS Compose project');
assert.match(workflow, /docker compose -f "\$compose_file" ps --all/,
  'preflight must inspect the real ECS Compose project');
assert.match(workflow, /docker-compose\.browser-worker\.yml/,
  'release must ship the Browser Worker Compose overlay');
assert.match(workflow, /QIANTIE_121_WORKER_SECRET/,
  'release must provision the Browser Worker internal secret');
assert.match(workflow, /QIANTIE_121_CREDENTIAL_SECRET/,
  'release must provision the Browser Worker credential secret');
assert.match(workflow, /QIANTIE_121_STORAGE_STATE_SECRET/,
  'release must provision the Browser Worker storage-state secret');
assert.match(workflow, /compose=\(docker compose -f "\$compose_file"/,
  'deployment must build the Compose command from the real project file');
assert.match(workflow, /"\$\{compose\[@\]\}" up -d --no-deps --force-recreate --pull never v88-node/,
  'deployment must recreate only v88-node from the real Compose project without pulling dependencies');
assert.match(workflow, /api\/novel-panel\/build-info/);
assert.match(workflow, /v78\.3\.0\.31/,
  'post-deploy verification must require the V31 public identity');
assert.match(workflow, /if \[ "\$ECS_DEPLOY_READY" != "true" \]/,
  'deployment must explicitly skip when the SSH secret is unavailable rather than pretending to deploy');
assert.match(workflow, /if:\s*failure\(\)/,
  'rollback step must run when verification fails');
assert.match(workflow, /rollback_image/);
assert.match(workflow, /container_id/,
  'deployment must identify the existing v88-node container before replacement');
assert.match(workflow, /\/tmp\/v88-last-service-image/,
  'rollback must persist the actual Compose service image tag');
assert.match(workflow, /docker tag "\$rollback_image" "\$service_image"/,
  'rollback must restore the prior actual Compose service image tag');

const deployBlock = workflow.slice(workflow.indexOf(deployMarker), workflow.indexOf(verifyMarker));
const rollbackBlock = workflow.slice(workflow.indexOf(rollbackMarker));
assert.ok(deployBlock.includes('grep -q "^${key}=" novel-fetch-121.env'),
  'secret generation must detect an existing key instead of appending a new value on every release');
assert.ok(deployBlock.includes("worker_service_image='v88-public-novel-fetch-121-worker:v88-latest'"),
  'first Browser Worker rollout must have a stable target image tag even when no old worker container exists');
assert.ok(deployBlock.includes('if [ -n "$worker_container_id" ]; then'),
  'existing Browser Worker rollback capture must be conditional');
const firstWorkerUp = deployBlock.indexOf('up -d --no-deps --force-recreate --pull never novel-fetch-121-worker');
assert.ok(firstWorkerUp >= 0,
  'deployment must create or recreate the Browser Worker');
assert.ok(!deployBlock.slice(0, firstWorkerUp).includes('test -n "$worker_container_id"'),
  'first Browser Worker rollout must not require a pre-existing worker container before it is created');
assert.ok(rollbackBlock.includes('if [ -s /tmp/v88-last-rollback-worker-image ]'),
  'rollback must distinguish upgrade rollback from a first-time worker rollout');
assert.ok(rollbackBlock.includes('rm -f novel-fetch-121-worker'),
  'first-time worker rollback must remove the newly introduced worker instead of requiring a nonexistent old image');

console.log('V78.3.0.31 guarded ECS deployment regression: PASS');
