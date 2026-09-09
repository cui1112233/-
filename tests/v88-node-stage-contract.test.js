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

test('staging workflow exact-SHA trigger is restricted to one marker on v88', () => {
  const workflow = readIfExists(workflowPath);
  assert.ok(workflow, 'node staging workflow must exist');
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- v88/);
  assert.match(workflow, /paths:\s*\n\s*- ['"]deploy\/v88-direct\/STAGE-REQUEST['"]/);
  assert.match(workflow, /GITHUB_SHA/);
  assert.match(workflow, /stage-node-host\.sh/);
  assert.match(workflow, /package-node-release\.sh/);
  assert.doesNotMatch(workflow, /\bscp\b/);
  assert.match(workflow, /split\s+-b\s+512K/);
  assert.match(workflow, /timeout\s+120\s+ssh/);
  assert.match(workflow, /sha256sum/);
  assert.doesNotMatch(workflow, /docker build|docker push|docker pull/);
});

test('Node staging leaves headroom for remote startup and reports stage timing', () => {
  const workflow = readIfExists(workflowPath);
  const source = readIfExists(scriptPath);
  assert.match(workflow, /timeout-minutes:\s*30/);
  const timeoutMatch = workflow.match(/REMOTE_STAGE_TIMEOUT_SECONDS:\s*(\d+)/);
  assert.ok(timeoutMatch, 'remote stage timeout must be declared explicitly');
  assert.ok(Number(timeoutMatch[1]) > 240, 'remote stage timeout must exceed the failed 240-second window');
  assert.match(workflow, /REMOTE_STAGE_START timeout_seconds=\$\{REMOTE_STAGE_TIMEOUT_SECONDS\}/);
  assert.match(workflow, /REMOTE_STAGE_DONE.*elapsed_seconds/);
  assert.match(source, /stage_log "cold bootstrap node v\$NODE_VERSION"/);
  assert.match(source, /stage_log "restart parallel stage service"/);
  assert.match(source, /stage_log "parallel stage verified sha=\$sha port=\$STAGE_PORT"/);
});

test('ECS SSH preparation retries host-key discovery and has a bounded accept-new fallback', () => {
  const workflow = readIfExists(workflowPath);
  assert.match(workflow, /for keyscan_attempt in 1 2 3/);
  assert.match(workflow, /SSH_HOSTKEYSCAN_FALLBACK=accept-new/);
  assert.match(workflow, /StrictHostKeyChecking=accept-new/);
});
