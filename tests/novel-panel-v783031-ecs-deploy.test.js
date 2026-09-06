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

assert.ok(workflow.includes(sshMarker), 'release workflow must prepare the ECS SSH channel');
assert.ok(workflow.includes(deployMarker), 'release workflow must contain a guarded ECS deploy step');
assert.ok(workflow.includes(verifyMarker), 'release workflow must verify the ECS rollout');
assert.ok(workflow.includes(rollbackMarker), 'release workflow must automatically rollback a failed ECS verification');
assert.ok(workflow.indexOf(pushMarker) < workflow.indexOf(sshMarker), 'ECS rollout must only start after GHCR publication succeeds');
assert.ok(workflow.indexOf(sshMarker) < workflow.indexOf(deployMarker), 'SSH setup must precede deployment');
assert.ok(workflow.indexOf(deployMarker) < workflow.indexOf(verifyMarker), 'deployment must precede public/runtime verification');
assert.ok(workflow.indexOf(verifyMarker) < workflow.indexOf(rollbackMarker), 'rollback handler must be defined after verification');

assert.match(workflow, /V88_ECS_SSH_PRIVATE_KEY/);
assert.match(workflow, /ECS_DEPLOY_READY/);
assert.match(workflow, /115\.190\.156\.223/);
assert.match(workflow, /ECS_USER:\s*root/);
assert.match(workflow, /docker save "\$IMAGE_NAME" \| gzip -1 \| ssh/,
  'runner must stream the already verified image directly to ECS without persisting registry credentials there');
assert.match(workflow, /v88-public-v88-node:rollback-/,
  'current production image must be tagged for rollback before replacement');
assert.match(workflow, /service_image/,
  'deployment must discover and preserve the actual v88-node Compose image tag');
assert.match(workflow, /docker tag .*\$image_name.*\$service_image/,
  'verified image must replace the actual Compose image tag used by production');
assert.match(workflow, /\/opt\/qiantie\/v88\/deploy\/v88-public\/docker-compose\.yml/,
  'deployment must use the verified v88-public Compose file');
assert.match(workflow, /docker compose -f "\$compose_file" config/,
  'deployment must validate the real Compose file');
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

console.log('V78.3.0.31 guarded ECS deployment regression: PASS');
