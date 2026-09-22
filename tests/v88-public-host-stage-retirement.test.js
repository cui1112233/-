const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('retired host-stage entry points cannot route public V88 traffic through a host port or container IP', () => {
  const stage = read('deploy/v88-direct/stage-node-host.sh');
  const cutover = read('deploy/v88-direct/cutover-node-host.sh');
  const stageWorkflow = read('.github/workflows/v88-direct-deploy-node-stage.yml');
  const cutoverWorkflow = read('.github/workflows/v88-direct-deploy-node-cutover.yml');

  for (const source of [stage, cutover, stageWorkflow, cutoverWorkflow]) {
    assert.match(source, /retired/i);
    assert.doesNotMatch(source, /18081|NetworkSettings\.Networks|QIANTIE_GO_BASE_URL=http:\/\/\$\w+_ip|nginx\s+-s\s+reload/);
  }
  assert.doesNotMatch(stageWorkflow, /stage-node-host\.sh/);
  assert.doesNotMatch(cutoverWorkflow, /cutover-node-host\.sh/);
});