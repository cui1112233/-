'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const workflow = read('.github/workflows/v88-unified-public-image-release.yml');
const stageWorkflow = read('.github/workflows/v88-direct-deploy-node-stage.yml');
const stageScript = read('deploy/v88-direct/stage-node-host.sh');
const cutoverScript = read('deploy/v88-direct/cutover-node-host.sh');
const compose = read('deploy/v88-public/docker-compose.yml');

test('unified V88 release publishes paired immutable Node and Go images from the checked-out revision', () => {
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /context: \./);
  assert.match(workflow, /file: Dockerfile/);
  assert.match(workflow, /context: backend/);
  assert.match(workflow, /file: backend\/Dockerfile/);
  assert.match(workflow, /QIANTIE_RELEASE_SHA=\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /qiantie-v88-node/);
  assert.match(workflow, /qiantie-go-api/);
});

test('host-stage release and cutover entry points are explicit tombstones', () => {
  for (const source of [stageWorkflow, stageScript, cutoverScript]) {
    assert.match(source, /retired/i);
    assert.match(source, /exit 64/);
    assert.doesNotMatch(source, /18081|NetworkSettings\.Networks|nginx\s+-s\s+reload/);
  }
});

test('browser worker remains on the shared Docker DNS network without host IP discovery', () => {
  assert.match(compose, /browser-worker:/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
  assert.match(compose, /name: v88-public_qiantie_internal/);
  assert.doesNotMatch(compose, /NetworkSettings|container_ip|172\.19\./);
});