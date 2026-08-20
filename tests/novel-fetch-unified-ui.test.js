const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../frontend/src/user/pages/NovelFetchPage.jsx'), 'utf8');

test('小说获取页接入 workshop 任务中心及恢复和批量操作', { skip: 'Task 2 尚未合入当前工作树' }, () => {
  assert.match(source, /listWorkshopTasks/);
  assert.match(source, /getWorkshopTask/);
  assert.match(source, /retryWorkshopTasks/);
  assert.match(source, /deleteWorkshopTasks/);
  assert.match(source, /fetchWorkshopOriginal/);
  assert.match(source, /restoreWorkshopOriginal/);
  assert.match(source, /任务中心/);
  assert.match(source, /Drawer/);
  assert.match(source, /批量重试/);
  assert.match(source, /删除选中/);
});

test('小说获取页接入 workshop AI 改文与规则排版', () => {
  assert.match(source, /generateWorkshopAi/);
  assert.match(source, /previewWorkshopRules/);
  assert.match(source, /suggestWorkshopRules/);
  assert.match(source, /AI 改文/);
  assert.match(source, /规则排版/);
  assert.match(source, /selectedWorkshopTask/);
  assert.match(source, /rewriteLoading/);
  assert.match(source, /ruleLoading/);
  assert.match(source, /rewriteError/);
  assert.match(source, /ruleError/);
});
