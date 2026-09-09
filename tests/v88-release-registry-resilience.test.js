const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const packageScript = read('deploy/v88-direct/package-node-release.sh');
const stageWorkflow = read('.github/workflows/v88-direct-deploy-node-stage.yml');
const stageScript = read('deploy/v88-direct/stage-node-host.sh');
const cutoverScript = read('deploy/v88-direct/cutover-node-host.sh');
const workerOverlay = read('deploy/v88-public/docker-compose.browser-worker.yml');

test('V88 Git-direct release uses a bounded slim payload instead of a registry or whole-repository transfer', () => {
  assert.match(packageScript, /required=\(/);
  assert.match(packageScript, /forbidden=\(/);
  assert.match(packageScript, /PAYLOAD_BYTES/);
  assert.doesNotMatch(packageScript, /tar[^\n]*-czf[^\n]*\s\.\s*$/m);
  assert.doesNotMatch(stageWorkflow, /\bscp\b/);
  assert.match(stageWorkflow, /split\s+-b\s+512K/);
  assert.match(stageWorkflow, /timeout\s+120\s+ssh/);
  const timeoutMatch = stageWorkflow.match(/REMOTE_STAGE_TIMEOUT_SECONDS:\s*(\d+)/);
  assert.ok(timeoutMatch, 'remote stage timeout must be declared explicitly');
  const timeoutSeconds = Number(timeoutMatch[1]);
  assert.ok(timeoutSeconds > 240 && timeoutSeconds <= 1800, 'remote stage timeout must allow cold bootstrap but remain bounded');
  assert.match(stageWorkflow, /timeout\s+"\$REMOTE_STAGE_TIMEOUT_SECONDS"\s+ssh/);
  assert.match(stageWorkflow, /sha256sum/);
  assert.doesNotMatch(stageWorkflow, /docker build|docker push|docker pull|docker\/login-action/);
});

test('V88 Git-direct staging pins exact source identity and refuses mismatched RELEASE-SHA', () => {
  assert.match(stageWorkflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(stageScript, /RELEASE-SHA/);
  assert.match(stageScript, /does not match requested SHA/);
  assert.match(stageScript, /api\/build-info/);
  assert.match(stageScript, /git_sha/);
});

test('V88 Git-direct public cutover backs up routing and automatically restores Docker Node on failure', () => {
  assert.match(cutoverScript, /backup=/);
  assert.match(cutoverScript, /rollback\(\)/);
  assert.match(cutoverScript, /trap rollback ERR/);
  assert.match(cutoverScript, /docker ps --filter ['"]name=v88-public-v88-node['"]/);
  assert.match(cutoverScript, /current_node_endpoints/);
  assert.match(cutoverScript, /matching_node_endpoints/);
  assert.match(cutoverScript, /nginx -t/);
  assert.match(cutoverScript, /nginx -s reload/);
  assert.doesNotMatch(cutoverScript, /OLD_UPSTREAM=v88-public-v88-node-1:3000/);
  assert.doesNotMatch(cutoverScript, /docker\s+(stop|rm)|docker\s+compose\s+down/);
});

test('121 Browser Worker stays on the shared Docker network while host Node discovers its proven runtime IP', () => {
  assert.match(workerOverlay, /novel-fetch-121-worker:/);
  assert.match(workerOverlay, /\r?\n    networks:\r?\n      default:/);
  assert.match(stageScript, /v88-public-browser-worker/);
  assert.match(stageScript, /container_ip/);
  assert.match(stageScript, /QIANTIE_121_BROWSER_WORKER_URL=http:\/\/\$worker_ip:8787/);
});
