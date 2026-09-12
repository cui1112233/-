const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'v88-shuihuo-legacy-compat-release.yml');

test('Shuihuo compatibility release creates and grants only its isolated database', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /CREATE DATABASE IF NOT EXISTS qiantie_shuihuo/);
  assert.match(workflow, /GRANT ALL PRIVILEGES ON qiantie_shuihuo\.\* TO/);
  assert.doesNotMatch(workflow, /GRANT ALL PRIVILEGES ON qiantie_v88\.\*/);
});
