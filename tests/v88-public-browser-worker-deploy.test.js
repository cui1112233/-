const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const compose = read('deploy/v88-public/docker-compose.browser-worker.yml');
const stage = read('deploy/v88-direct/stage-node-host.sh');
const cutover = read('deploy/v88-direct/cutover-node-host.sh');

test('V88 public compose overlay keeps the existing 121 Browser Worker isolated and persistent', () => {
  assert.match(compose, /novel-fetch-121-worker:/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL:\s*http:\/\/novel-fetch-121-worker:8787/);
  assert.ok((compose.match(/\.\/novel-fetch-121\.env/g) || []).length >= 2, 'existing Docker Node and Browser Worker must keep the shared secret env file during migration');
  assert.match(compose, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET\}/);
  assert.match(compose, /novel-fetch-121-data:\/data/);
  assert.doesNotMatch(compose, /ports:\s*[\s\S]{0,120}8787/);
});

test('Git-direct host Node reuses the running 121 Browser Worker instead of rebuilding or replacing it', () => {
  assert.match(stage, /worker_id="\$\(container_id v88-public-browser-worker\)"/);
  assert.match(stage, /worker_ip="\$\(container_ip "\$worker_id"\)"/);
  assert.match(stage, /QIANTIE_121_BROWSER_WORKER_URL=http:\/\/\$worker_ip:8787/);
  assert.doesNotMatch(stage, /docker\s+(build|pull|push|stop|rm)/);
});

test('Node public cutover leaves Browser Worker and Go routing untouched', () => {
  assert.match(cutover, /docker ps --filter ['"]name=v88-public-v88-node['"]/);
  assert.match(cutover, /current_node_endpoints/);
  assert.match(cutover, /matching_node_endpoints/);
  assert.match(cutover, /STAGE_PORT=18081/);
  assert.doesNotMatch(cutover, /novel-fetch-121-worker:8787/);
  assert.doesNotMatch(cutover, /go-api:4000/);
  assert.doesNotMatch(cutover, /docker\s+(stop|rm)|docker\s+compose\s+down/);
});
