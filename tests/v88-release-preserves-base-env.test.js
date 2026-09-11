'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const compose = fs.readFileSync('deploy/v88-public/docker-compose.yml', 'utf8');
const stage = fs.readFileSync('deploy/v88-direct/stage-node-host.sh', 'utf8');

test('unified V88 public Compose retains MySQL configuration while pinning the release through environment references', () => {
  assert.match(compose, /QIANTIE_MYSQL_DSN: \$\{MYSQL_USER\}:\$\{MYSQL_PASSWORD\}@tcp\(mysql:3306\)\/\$\{MYSQL_DATABASE\}/);
  assert.match(compose, /QIANTIE_GO_IMAGE:\?set an immutable Go image reference/);
  assert.match(compose, /QIANTIE_NODE_IMAGE:\?set an immutable Node image reference/);
  assert.match(compose, /QIANTIE_RELEASE_SHA/);
  assert.match(compose, /QIANTIE_GO_BASE_URL: http:\/\/go-api:4000/);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
});

test('retired Git-direct host staging cannot become a second V88 environment source', () => {
  assert.match(stage, /Retired: V88 public releases must use the unified Docker Compose runner/);
  assert.match(stage, /exit 64/);
  assert.doesNotMatch(stage, /docker inspect|18081|QIANTIE_DEPLOY_MODE=git-direct-stage/);
});
