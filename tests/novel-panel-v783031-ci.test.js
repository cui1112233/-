'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/novel-panel-v783031-regression.yml');

assert.ok(fs.existsSync(workflowPath), 'V78.3.0.31 dedicated regression workflow must exist');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert.match(workflow, /name:\s*Novel Panel V78\.3\.0\.31 Regression/);
assert.match(workflow, /branches:\s*\n\s*-\s*v88/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /node-version:\s*['"]20['"]/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /node --test tests\/novel-panel-v783031-\*\.test\.js/);

for (const filename of [
  'novel-panel-v783031-runtime.test.js',
  'novel-panel-v783031-regeneration-middleware.test.js',
  'novel-panel-v783031-director-outline.test.js',
  'novel-panel-v783031-server-mount.test.js',
  'novel-panel-v783031-retired-freshness.test.js',
]) {
  assert.ok(fs.existsSync(path.join(root, 'tests', filename)), `${filename} must stay in the V31 regression suite`);
}

console.log('V78.3.0.31 CI contract regression: PASS');
