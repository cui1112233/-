const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'frontend/src/user/pages/ScriptPage.jsx'), 'utf8');

test('script page provides entity creation, protagonist toggling and deletion controls', () => {
  assert.match(source, /添加\{title\}/);
  assert.match(source, /addEntity\('characters'\)/);
  assert.match(source, /addEntity\('scenes'\)/);
  assert.match(source, /toggleProtagonist/);
  assert.match(source, /删除人物/);
  assert.match(source, /删除场景/);
  assert.match(source, /Popconfirm/);
  assert.match(source, /Star/);
  assert.match(source, /根据小说智能补全/);
  assert.match(source, /原文依据/);
  assert.match(source, /AI 建议/);
  assert.match(source, /不确定项/);
  assert.match(source, /enrichScriptEntity/);
  assert.match(source, /applyEntityEnrichment/);
});
