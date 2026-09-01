const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js'), 'utf8');

test('V78 task filters drive the existing task table instead of a duplicate result list', () => {
  assert.ok(source.includes('installLegacyTaskListBridge'));
  assert.ok(source.includes('loadTasks = async function'));
  assert.ok(source.includes('renderTasks = function'));
  assert.ok(source.includes('buildTaskQuery'));
  assert.ok(source.includes('patchTaskTableForV78'));
  assert.ok(!source.includes('id="v78AdvancedTaskResults"'));
});

test('V78 default task view remains server-owned today plus historical unfinished', () => {
  assert.ok(source.includes("date: ''"));
  assert.ok(source.includes("bookId: ''"));
  assert.ok(source.includes("status: ''"));
  assert.ok(source.includes('今天 + 历史未完成'));
  assert.ok(source.includes('v78TaskToday'));
});

test('sparse AI summary uses target versions instead of continuous ai_count ranges', () => {
  assert.ok(source.includes('function selectedAiVersions'));
  assert.ok(source.includes('task.ai_target_versions'));
  assert.ok(source.includes('task.ai_generated_versions'));
  assert.ok(source.includes('AI文案'));
  assert.ok(source.includes('push_date'));
  assert.ok(source.includes('推送日期'));
});
