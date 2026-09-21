const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');

test('API config page exposes and saves the H3 workflow id', () => {
  assert.match(page, /presetWorkflowIds/);
  assert.match(page, /workflowId/);
  assert.match(page, /AutoDL 工作流 ID/);
  assert.match(page, /payload\.workflowId/);
  assert.match(page, /保存工作流/);
});
