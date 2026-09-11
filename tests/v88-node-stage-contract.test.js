const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const stage = fs.readFileSync('deploy/v88-direct/stage-node-host.sh', 'utf8');
const workflow = fs.readFileSync('.github/workflows/v88-direct-deploy-node-stage.yml', 'utf8');

test('host Node staging is retired instead of creating a second V88 runtime', () => {
  assert.match(stage, /Retired:/);
  assert.match(stage, /exit 64/);
  assert.doesNotMatch(stage, /18081|systemctl|docker inspect|curl .*nodejs\.org/);
});

test('host-stage workflow is manual explanation only and cannot transfer or release an image', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /retired/i);
  assert.match(workflow, /exit 64/);
  assert.doesNotMatch(workflow, /\bscp\b|docker (build|push|pull)|split\s+-b|stage-node-host\.sh/);
});
