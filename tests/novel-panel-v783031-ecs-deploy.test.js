'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/v88-linux-amd64-image-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

const pushMarker = '- name: Push V88 AMD64 image to GHCR';
const sshMarker = '- name: Prepare V88 ECS SSH';
const deployMarker = '- name: Deploy verified images to V88 ECS';
const verifyMarker = '- name: Verify V88 ECS deployment';
const rollbackMarker = '- name: Rollback V88 ECS on failed verification';

assert.ok(workflow.includes(pushMarker), 'release workflow must publish the compact main V88 image to GHCR');
assert.ok(workflow.includes(sshMarker), 'release workflow must prepare the ECS SSH channel');
assert.ok(workflow.includes(deployMarker), 'release workflow must contain a guarded ECS deploy step');
assert.ok(workflow.includes(verifyMarker), 'release workflow must verify the ECS rollout');
assert.ok(workflow.includes(rollbackMarker), 'release workflow must automatically rollback a failed ECS verification');
assert.ok(workflow.indexOf(pushMarker) < workflow.indexOf(sshMarker), 'main-image GHCR publication must finish before ECS rollout starts');
assert.ok(workflow.indexOf(sshMarker) < workflow.indexOf(deployMarker), 'SSH setup must precede deployment');
assert.ok(workflow.indexOf(deployMarker) < workflow.indexOf(verifyMarker), 'deployment must precede public/runtime verification');
assert.ok(workflow.indexOf(verifyMarker) < workflow.indexOf(rollbackMarker), 'rollback handler must be defined after verification');

assert.match(workflow, /V88_ECS_SSH_PRIVATE_KEY/);
assert.match(workflow, /ECS_DEPLOY_READY/);
assert.match(workflow, /115\.190\.156\.223/);
assert.match(workflow, /ECS_USER:\s*root/);
assert.match(workflow, /docker push "\$WORKER_GHCR_IMAGE"/,
  'the Browser Worker must have an immutable GHCR image before ECS rollout');
assert.match(workflow, /pull_with_retry\s*\(\)/,
  'ECS rollout must use a bounded registry pull helper');
assert.match(workflow, /timeout 120 docker pull "\$image"/,
  'the bounded helper must pull its immutable image with a finite timeout');
assert.match(workflow, /pull_with_retry "\$ghcr_image"/,
  'ECS must pull the immutable main image before considering the tar fallback');
assert.match(workflow, /pull_with_retry "\$worker_ghcr_image"/,
  'ECS must pull the immutable Browser Worker image instead of using an unbounded SSH image stream');
assert.doesNotMatch(workflow, /docker save "\$IMAGE_NAME" \| gzip -1 \| ssh/,
  'ECS rollout must not use an unbounded main-image SSH stream');
assert.doesNotMatch(workflow, /docker save "\$WORKER_IMAGE_NAME" \| gzip -1 \| ssh/,
  'ECS rollout must not use an unbounded Browser Worker SSH stream');
assert.match(workflow, /ServerAliveInterval=15/);
assert.match(workflow, /timeout 900/,
  'ECS rollout must have a finite worker transfer/deploy timeout');
assert.match(workflow, /concurrency:\s*[\s\S]*?cancel-in-progress:\s*true/,
  'public ECS rollouts must not run concurrently');
assert.match(workflow, /v88-public-v88-node:rollback-/,
  'current production image must be tagged for rollback before replacement');
assert.match(workflow, /service_image/,
  'deployment must discover and preserve the actual v88-node Compose image tag');
assert.match(workflow, /docker tag .*\$ghcr_image.*\$service_image/,
  'verified image must replace the actual Compose image tag used by production');
assert.match(workflow, /\/opt\/qiantie\/v88\/deploy\/v88-public\/docker-compose\.yml/,
  'deployment must use the verified v88-public Compose file');
assert.match(workflow, /docker compose -f "\$compose_file" config/,
  'deployment must validate the real Compose file');
assert.match(workflow, /compose=\(docker compose --env-file "\$compose_dir\/novel-fetch-121\.env" -f "\$compose_file"/,
  'deployment must build the Compose command from the real project file and canonical 121 env file');
assert.match(workflow, /"\$\{compose\[@\]\}" up -d --no-deps --force-recreate --pull never v88-node/,
  'deployment must recreate only v88-node from the real Compose project without pulling dependencies');

const verifyBlock = workflow.slice(workflow.indexOf(verifyMarker), workflow.indexOf(rollbackMarker));
assert.doesNotMatch(verifyBlock, /api\/novel-panel\/build-info/,
  'release verification must not anonymously probe the authenticated Novel Panel build-info endpoint');
assert.match(verifyBlock, /GHCR_IMAGE/,
  'release verification must receive the immutable commit-specific GHCR image');
assert.match(verifyBlock, /docker image inspect "\$ghcr_image" --format '\{\{\.Id\}\}'/,
  'release verification must resolve the expected image ID from the immutable GHCR image');
assert.match(verifyBlock, /docker inspect "\$node_id" --format '\{\{\.Image\}\}'/,
  'release verification must read the running v88-node container image ID');
assert.match(verifyBlock, /expected_node_image_id/,
  'release verification must compare the expected main image ID');
assert.match(verifyBlock, /running_node_image_id/,
  'release verification must compare the running main image ID');
assert.match(verifyBlock, /api\/build-info/,
  'release verification may use the public build-info endpoint only as an HTTP liveness probe');
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
assert.ok(!deployBlock.includes('test -n "$worker_container_id"'),
  'first Browser Worker rollout must not require a pre-existing worker container');
assert.ok(rollbackBlock.includes('if [ -s /tmp/v88-last-rollback-worker-image ]'),
  'rollback must distinguish upgrade rollback from a first-time worker rollout');
assert.ok(rollbackBlock.includes('rm -f novel-fetch-121-worker'),
  'first-time worker rollback must remove the newly introduced worker instead of requiring a nonexistent old image');

console.log('V78.3.0.31 guarded ECS deployment regression: PASS');
