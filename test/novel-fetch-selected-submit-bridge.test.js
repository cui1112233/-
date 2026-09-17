const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('selected-task submit bridge falls back to the task-list selection when V2 preview ids are empty', () => {
  const bridge = read('public/batch-rewrite/v78-selected-task-submit-bridge.js');
  const page = read('lib/novel-fetch-workshop/v2-page.js');

  assert.match(bridge, /window\.qiantieSubmitSelectedTasks/);
  assert.match(bridge, /Array\.isArray\(ids\)/);
  assert.match(bridge, /explicitIds\.length \? original\(explicitIds\) : original\(\)/);
  assert.match(page, /v78-selected-task-submit-bridge\.js\?v=20260917-task-list-fallback-r1/);
});
