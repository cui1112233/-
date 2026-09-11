const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { injectNovelFetchV2Script } = require('../lib/novel-fetch-workshop/v2-page');

const compose = fs.readFileSync('deploy/v88-public/docker-compose.yml', 'utf8');
const stage = fs.readFileSync('deploy/v88-direct/stage-node-host.sh', 'utf8');
const cutover = fs.readFileSync('deploy/v88-direct/cutover-node-host.sh', 'utf8');
const loginHotfix = fs.readFileSync('frontend/public/batch-rewrite/121-login-hotfix.js', 'utf8');

test('unified V88 Compose preserves Browser Worker sessions and uses Docker DNS', () => {
  assert.match(compose, /browser-worker:/);
  assert.match(compose, /browser_sessions:\/data\/sessions/);
  assert.match(compose, /name: v88-public_browser_sessions/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
  assert.doesNotMatch(compose, /ports:[\s\S]{0,120}8787/);
});

test('retired host scripts cannot replace Browser Worker or Go routing', () => {
  for (const source of [stage, cutover]) {
    assert.match(source, /Retired:/);
    assert.doesNotMatch(source, /docker\s+(build|pull|push|stop|rm)|18081|NetworkSettings/);
  }
});

test('served novel-fetch page injects one current cache-busted 121 login guard after the legacy app', () => {
  const source = '<html><body><script src="./app.js?v=20260826-login-layout2"></script></body></html>';
  const first = injectNovelFetchV2Script(source);
  const second = injectNovelFetchV2Script(first);
  assert.match(loginHotfix, /REQUEST_TIMEOUT_MS\s*=\s*65_000/);
  assert.match(first, /\/batch-rewrite\/121-login-hotfix\.js\?v=20260909-login-timeout65-r1/);
  assert.ok(first.indexOf('app.js?v=20260826-login-layout2') < first.indexOf('121-login-hotfix.js'));
  assert.equal((second.match(/121-login-hotfix\.js/g) || []).length, 1);
});
