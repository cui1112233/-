const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const workflow = fs.readFileSync('.github/workflows/v88-unified-public-image-release.yml', 'utf8');

test('unified V88 release can be explicitly requested from v88 without using retired host-stage paths', () => {
  assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[?v88\]?/);
  assert.match(workflow, /deploy\/v88-public\/UNIFIED-DEPLOY-REQUEST/);
  assert.doesNotMatch(workflow, /stage-node-host\.sh|cutover-node-host\.sh|18081/);
});

test('unified V88 release deploys the paired immutable Node and Go images from the same SHA', () => {
  assert.match(workflow, /qiantie-v88-node:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /qiantie-go-api:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /deploy:\s*[\s\S]*needs:\s*release/);
  assert.match(workflow, /QIANTIE_NODE_IMAGE/);
  assert.match(workflow, /QIANTIE_GO_IMAGE/);
  assert.match(workflow, /QIANTIE_RELEASE_SHA/);
  assert.match(workflow, /docker compose[^\n]*config -q/);
  assert.match(workflow, /up -d[^\n]*go-api v88-node/);
});

test('unified V88 deploy records rollback state and restores it on failed acceptance', () => {
  assert.match(workflow, /PREVIOUS_PUBLIC_BUILD/);
  assert.match(workflow, /backup_env/);
  assert.match(workflow, /rollback/);
  assert.match(workflow, /cp -a "\$backup_env" \.env/);
});

test('unified V88 deploy accepts the public runtime only when exact release identity and Batch Factory routes are reachable', () => {
  assert.match(workflow, /api\/build-info/);
  assert.match(workflow, /batch-factory/);
  assert.match(workflow, /api\/batch-factory\/v11\/capabilities/);
  assert.match(workflow, /expected_sha/);
});