const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { injectNovelFetchV2Script } = require('../lib/novel-fetch-workshop/v2-page');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const compose = read('deploy/v88-public/docker-compose.browser-worker.yml');
const stage = read('deploy/v88-direct/stage-node-host.sh');
const cutover = read('deploy/v88-direct/cutover-node-host.sh');
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

test('served novel-fetch page injects the current cache-busted 121 login guard after the legacy app', () => {
  const source = '<html><body><script src="./app.js?v=20260826-login-layout2"></script></body></html>';
  const first = injectNovelFetchV2Script(source);
  const second = injectNovelFetchV2Script(first);
  assert.match(loginHotfix, /REQUEST_TIMEOUT_MS\s*=\s*65_000/);
  assert.match(first, /\/batch-rewrite\/121-login-hotfix\.js\?v=20260909-login-timeout65-r1/);
  assert.ok(first.indexOf('app.js?v=20260826-login-layout2') < first.indexOf('121-login-hotfix.js'), 'the hotfix must run after app.js defines api/openWebLoginDialog');
  assert.equal((second.match(/121-login-hotfix\.js/g) || []).length, 1, 'the served page must load one login guard only');
  assert.doesNotMatch(first, /20260831-config-guard1/, 'the served page must not pin the historical 15-second guard asset id');
});
