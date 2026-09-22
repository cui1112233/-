const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'v88-shuihuo-legacy-compat-release.yml');

test('Shuihuo compatibility release creates and grants only its isolated database', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const composePath = path.resolve(__dirname, '..', 'deploy', 'v88-public', 'docker-compose.yml');
  const compose = fs.readFileSync(composePath, 'utf8');

  assert.match(workflow, /CREATE DATABASE IF NOT EXISTS qiantie_shuihuo_compat/);
  assert.match(workflow, /GRANT ALL PRIVILEGES ON qiantie_shuihuo_compat\.\* TO/);
  assert.match(compose, /QIANTIE_MYSQL_DSN:.*\/qiantie_shuihuo_compat\?/);
  assert.doesNotMatch(workflow, /GRANT ALL PRIVILEGES ON qiantie_v88\.\*/);
  assert.doesNotMatch(workflow, /GRANT ALL PRIVILEGES ON qiantie_shuihuo\.\*/);
  assert.doesNotMatch(compose, /QIANTIE_MYSQL_DSN:.*\/qiantie_v88\?/);
  assert.match(workflow, /ref: integration\/remote-workbench-20260819/);
  assert.match(workflow, /checkout --detach b111737265d9352df9e54cecde7e2df5d2710da4/);
  assert.match(workflow, /shuihuo-legacy-b1117372/);
  assert.doesNotMatch(workflow, /docker image inspect qiantie-go-api:public-v78/);
});
