const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const compose = read('deploy/v88-public/docker-compose.browser-worker.yml');
const stage = read('deploy/v88-direct/stage-node-host.sh');
const cutover = read('deploy/v88-direct/cutover-node-host.sh');
const batchRewriteIndex = read('frontend/public/batch-rewrite/index.html');
const loginHotfix = read('frontend/public/batch-rewrite/121-login-hotfix.js');

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
  assert.match(cutover, /v88-public-v88-node-1:3000/);
  assert.doesNotMatch(cutover, /novel-fetch-121-worker:8787/);
  assert.doesNotMatch(cutover, /go-api:4000/);
  assert.doesNotMatch(cutover, /docker\s+(stop|rm)|docker\s+compose\s+down/);
});

test('novel-fetch source owns the current 121 login guard asset instead of relying on a stale release-only tag', () => {
  const appTag = '<script src="./app.js?v=20260826-login-layout2"></script>';
  const guardTag = '<script id="qiantie-121-login-hotfix" src="./121-login-hotfix.js?v=20260909-login-timeout65-r1"></script>';
  assert.match(loginHotfix, /REQUEST_TIMEOUT_MS\s*=\s*65_000/);
  assert.ok(batchRewriteIndex.includes(appTag), 'the legacy batch-rewrite app must bootstrap first');
  assert.ok(batchRewriteIndex.includes(guardTag), 'the source page must load the current cache-busted 65-second login guard');
  assert.ok(batchRewriteIndex.indexOf(appTag) < batchRewriteIndex.indexOf(guardTag), 'the guard must run after app.js defines api/openWebLoginDialog');
  assert.doesNotMatch(batchRewriteIndex, /20260831-config-guard1/, 'the source page must not pin the historical 15-second guard asset id');
});
