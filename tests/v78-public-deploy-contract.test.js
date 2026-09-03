const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deployDir = path.join(__dirname, '..', 'deploy', 'v78-public');
const compose = fs.readFileSync(path.join(deployDir, 'docker-compose.yml'), 'utf8');
const deploy = fs.readFileSync(path.join(deployDir, 'deploy.sh'), 'utf8');
const rollback = fs.readFileSync(path.join(deployDir, 'rollback.sh'), 'utf8');

test('public V78 Compose pins Node to the approved immutable image', () => {
  assert.match(compose, /image: \$\{QIANTIE_NODE_IMAGE:-qiantie-v78-node@sha256:7170d92a9cac698fb021ff9a354a418ec946d4a0316a9229de119484e2f25474\}/);
  assert.doesNotMatch(compose, /v78-node:\n\s+build:/);
});

test('public deployment verifies Node provenance and never builds Node on ECS', () => {
  assert.match(deploy, /docker image inspect "\$NODE_IMAGE"/);
  assert.match(deploy, /org\.opencontainers\.image\.revision/);
  assert.match(deploy, /build go-api browser-worker/);
  assert.doesNotMatch(deploy, /build go-api browser-worker v78-node/);
  assert.match(deploy, /up -d --no-build mysql go-api browser-worker v78-node/);
});

test('public rollback selects explicit image references without retagging production', () => {
  assert.match(rollback, /QIANTIE_NODE_ROLLBACK_IMAGE/);
  assert.match(rollback, /QIANTIE_GO_ROLLBACK_IMAGE/);
  assert.match(rollback, /QIANTIE_BROWSER_WORKER_ROLLBACK_IMAGE/);
  assert.doesNotMatch(rollback, /docker tag/);
  assert.match(rollback, /up -d --no-build --no-deps go-api browser-worker v78-node/);
});
