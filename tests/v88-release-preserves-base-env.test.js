'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const stage = fs.readFileSync('deploy/v88-direct/stage-node-host.sh', 'utf8');

test('V88 Git-direct staging inherits the running production Node environment instead of inventing a new base env', () => {
  assert.match(stage, /docker inspect -f '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' "\$node_id"/);
  assert.match(stage, /install -m 0600 "\$tmp_env" "\$STAGE_ENV"/);
  assert.match(stage, /v88-public-v88-node/);
});

test('V88 Git-direct staging preserves MySQL runtime configuration while overriding only release and upstream fields', () => {
  const filter = stage.match(/grep -vE '([^']+)'/);
  assert.ok(filter, 'staging must explicitly filter only container/runtime-specific environment fields');
  assert.doesNotMatch(filter[1], /MYSQL_USER|MYSQL_PASSWORD|MYSQL_DATABASE|MYSQL_HOST|MYSQL_PORT/,
    'MySQL runtime configuration must flow through from the running production Node');
  assert.match(stage, /QIANTIE_GO_BASE_URL/);
  assert.match(stage, /QIANTIE_121_BROWSER_WORKER_URL/);
  assert.match(stage, /QIANTIE_RELEASE_SHA/);
  assert.match(stage, /QIANTIE_DEPLOY_MODE=git-direct-stage/);
});
