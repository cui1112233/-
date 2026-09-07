const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const scriptPath = 'deploy/v88-direct/stage-node-host.sh';
const workflowPath = '.github/workflows/v88-direct-deploy-node-stage.yml';

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('Node staging is parallel-only and never cuts existing public traffic', () => {
  const source = readIfExists(scriptPath);
  assert.ok(source, 'stage-node-host.sh must exist');
  assert.match(source, /18081/);
  assert.doesNotMatch(source, /docker\s+(stop|rm|compose\s+down)/);
  assert.doesNotMatch(source, /nginx\s+-s\s+reload/);
  assert.doesNotMatch(source, /systemctl\s+stop\s+.*v88-public/);
  assert.doesNotMatch(source, /ln\s+-sfn[^\n]*\/opt\/qiantie\/v88\/current/);
});

test('Node staging reuses production persistence and proven Docker upstreams', () => {
  const source = readIfExists(scriptPath);
  assert.ok(source, 'stage-node-host.sh must exist');
  assert.match(source, /QIANTIE_GO_BASE_URL/);
  assert.match(source, /QIANTIE_121_BROWSER_WORKER_URL/);
  assert.match(source, /v88-public_qiantie_internal/);
  assert.match(source, /\/opt\/qiantie\/v88\/shared\/data/);
  assert.match(source, /\/opt\/qiantie\/v88\/shared\/outputs/);
  assert.match(source, /v88-public-browser-worker/);
});

test('Node staging installs pinned runtime and proves exact release SHA', () => {
  const source = readIfExists(scriptPath);
  assert.ok(source, 'stage-node-host.sh must exist');
  assert.match(source, /24\.19\.0/);
  assert.match(source, /RELEASE-SHA/);
  assert.match(source, /api\/build-info/);
  assert.match(source, /git_sha/);
});

test('staging workflow exact-SHA trigger is restricted to one marker on the integration branch', () => {
  const workflow = readIfExists(workflowPath);
  assert.ok(workflow, 'node staging workflow must exist');
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/v88-direct-deploy-integration-20260907/);
  assert.match(workflow, /paths:\s*\n\s*- ['"]deploy\/v88-direct\/STAGE-REQUEST['"]/);
  assert.match(workflow, /GITHUB_SHA/);
  assert.match(workflow, /stage-node-host\.sh/);
  assert.match(workflow, /package-node-release\.sh/);
  assert.match(workflow, /timeout\s+\d+\s+scp/);
  assert.doesNotMatch(workflow, /docker build|docker push|docker pull/);
});
