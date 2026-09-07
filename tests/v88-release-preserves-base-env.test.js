'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/v88-linux-amd64-image-release.yml'), 'utf8');

const dualEnvCompose = /compose=\(docker compose --env-file "\$compose_dir\/\.env" --env-file "\$compose_dir\/novel-fetch-121\.env" -f "\$compose_file"/g;

test('V88 ECS release preserves the existing base .env while adding Novel Fetch 121 secrets', () => {
  const matches = workflow.match(dualEnvCompose) || [];
  assert.ok(matches.length >= 4, `expected deploy, release override, verify and rollback to use both env files; found ${matches.length}`);
  assert.match(workflow, /test -s "\$compose_dir\/\.env"/,
    'release must refuse to recreate v88-node when the canonical ECS .env is missing');
});

test('V88 ECS verification rejects a Node container with missing MySQL runtime configuration', () => {
  assert.match(workflow, /MYSQL_USER/);
  assert.match(workflow, /MYSQL_PASSWORD/);
  assert.match(workflow, /MYSQL_DATABASE/);
});
