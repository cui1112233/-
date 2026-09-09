'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const stageWorkflow = read('.github/workflows/v88-direct-deploy-node-stage.yml');
const cutoverWorkflow = read('.github/workflows/v88-direct-deploy-node-cutover.yml');
const cutoverScript = read('deploy/v88-direct/cutover-node-host.sh');

test('V78.3.0.31 public Node release stages exact v88 Git SHA before any traffic change', () => {
  assert.match(stageWorkflow, /branches:\s*\n\s*- v88/);
  assert.match(stageWorkflow, /deploy\/v88-direct\/STAGE-REQUEST/);
  assert.match(stageWorkflow, /GITHUB_SHA/);
  assert.match(stageWorkflow, /V88_ECS_SSH_PRIVATE_KEY/);
  assert.match(stageWorkflow, /115\.190\.156\.223/);
  assert.match(stageWorkflow, /package-node-release\.sh/);
  assert.match(stageWorkflow, /stage-node-host\.sh/);
  assert.match(stageWorkflow, /PUBLIC_ROUTE_STILL_HEALTHY=true/);
  assert.doesNotMatch(stageWorkflow, /docker build|docker push|docker pull/);
});

test('V78.3.0.31 public Node cutover is separately marker-gated and verifies exact deployed SHA', () => {
  assert.match(cutoverWorkflow, /branches:\s*\n\s*- v88/);
  assert.match(cutoverWorkflow, /deploy\/v88-direct\/CUTOVER-REQUEST/);
  assert.match(cutoverWorkflow, /\[0-9a-f\]\{40\}/);
  assert.match(cutoverWorkflow, /TARGET_SHA/);
  assert.match(cutoverWorkflow, /api\/build-info/);
  assert.match(cutoverWorkflow, /git-direct/);
  assert.match(cutoverWorkflow, /PUBLIC_CUTOVER_VERIFIED_SHA/);
});

test('V78.3.0.31 cutover changes only Node routing and keeps a guarded Docker-Node rollback target', () => {
  assert.match(cutoverScript, /docker ps --filter ['"]name=v88-public-v88-node['"]/);
  assert.match(cutoverScript, /NetworkSettings\.Networks/);
  assert.match(cutoverScript, /Aliases/);
  assert.match(cutoverScript, /current_node_endpoints/);
  assert.match(cutoverScript, /matching_node_endpoints/);
  assert.match(cutoverScript, /STAGE_PORT=18081/);
  assert.match(cutoverScript, /backup=/);
  assert.match(cutoverScript, /rollback\(\)/);
  assert.match(cutoverScript, /nginx -t/);
  assert.match(cutoverScript, /nginx -s reload/);
  assert.doesNotMatch(cutoverScript, /OLD_UPSTREAM=v88-public-v88-node-1:3000/);
  assert.doesNotMatch(cutoverScript, /docker\s+(stop|rm)|docker\s+compose\s+down/);
  assert.doesNotMatch(cutoverScript, /go-api:4000/);
});
