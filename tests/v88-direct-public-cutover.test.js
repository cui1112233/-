const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('legacy Docker public release is manual-only and cannot build or publish images', () => {
  const source = read('.github/workflows/v88-linux-amd64-image-release.yml');
  assert.ok(source, 'legacy Docker workflow must remain as an explicit manual tombstone');
  assert.match(source, /workflow_dispatch/);
  assert.doesNotMatch(source, /\n\s*push:\s*\n/);
  assert.doesNotMatch(source, /docker\s+(build|push|pull)|docker\/login-action/);
});

test('production staging is marker-gated on v88 and deploys exact Git SHA without Docker images', () => {
  const source = read('.github/workflows/v88-direct-deploy-node-stage.yml');
  assert.ok(source, 'production Node staging workflow must exist');
  assert.match(source, /branches:\s*\n\s*- v88/);
  assert.match(source, /deploy\/v88-direct\/STAGE-REQUEST/);
  assert.match(source, /GITHUB_SHA/);
  assert.doesNotMatch(source, /docker build|docker push|docker pull/);
});

test('public cutover discovers the live Docker Node endpoint instead of hard-coding a compose container name', () => {
  const source = read('deploy/v88-direct/cutover-node-host.sh');
  assert.ok(source, 'cutover-node-host.sh must exist');
  assert.match(source, /docker ps --filter ['"]name=v88-public-v88-node['"]/);
  assert.match(source, /NetworkSettings\.Networks/);
  assert.match(source, /Aliases/);
  assert.match(source, /IPAddress/);
  assert.doesNotMatch(source, /OLD_UPSTREAM=v88-public-v88-node-1:3000/);
});

test('public cutover only rewires the mounted Nginx Node upstream and has automatic rollback', () => {
  const source = read('deploy/v88-direct/cutover-node-host.sh');
  assert.ok(source, 'cutover-node-host.sh must exist');
  assert.match(source, /\/etc\/nginx\/conf\.d\/default\.conf/);
  assert.match(source, /18081/);
  assert.match(source, /api\/build-info/);
  assert.match(source, /git_sha/);
  assert.match(source, /nginx -t/);
  assert.match(source, /nginx -s reload/);
  assert.match(source, /backup/);
  assert.match(source, /rollback/);
  assert.match(source, /current_node_endpoints/);
  assert.match(source, /matching_node_endpoints/);
  assert.doesNotMatch(source, /docker\s+(stop|rm)|docker\s+compose\s+down/);
  assert.doesNotMatch(source, /go-api:4000/);
});

test('public cutover is marker-gated on v88 and target SHA comes from the request marker', () => {
  const source = read('.github/workflows/v88-direct-deploy-node-cutover.yml');
  assert.ok(source, 'production Node cutover workflow must exist');
  assert.match(source, /branches:\s*\n\s*- v88/);
  assert.match(source, /deploy\/v88-direct\/CUTOVER-REQUEST/);
  assert.match(source, /CUTOVER-REQUEST/);
  assert.match(source, /\[0-9a-f\]\{40\}/);
  assert.match(source, /cutover-node-host\.sh/);
  assert.doesNotMatch(source, /docker build|docker push|docker pull/);
});
