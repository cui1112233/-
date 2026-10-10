const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');

test('API config provides the Fanke refresh and selection controls', () => {
  assert.match(page, /fanke-open-video/);
  assert.match(page, /刷新可用模型/);
  assert.match(page, /refreshFankeVideoModels/);
});
