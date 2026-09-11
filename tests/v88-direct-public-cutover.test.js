const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('retired host cutover cannot publish V88 traffic through a parallel Node port', () => {
  const stage = read('deploy/v88-direct/stage-node-host.sh');
  const cutover = read('deploy/v88-direct/cutover-node-host.sh');
  const stageWorkflow = read('.github/workflows/v88-direct-deploy-node-stage.yml');
  const cutoverWorkflow = read('.github/workflows/v88-direct-deploy-node-cutover.yml');
  for (const source of [stage, cutover, stageWorkflow, cutoverWorkflow]) {
    assert.match(source, /retired/i);
    assert.doesNotMatch(source, /18081|NetworkSettings\.Networks|nginx\s+-s\s+reload/);
  }
});

test('canonical Compose keeps Nginx, Node and Go on one named Docker network', () => {
  const compose = read('deploy/v88-public/docker-compose.yml');
  assert.match(compose, /name: v88-public_qiantie_internal/);
  assert.match(compose, /QIANTIE_GO_BASE_URL: http:\/\/go-api:4000/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
});
