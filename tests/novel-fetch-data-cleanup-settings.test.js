const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'SettingsPage.jsx'), 'utf8');

test('settings exposes novel fetch data and cleanup controls on the existing settings page', () => {
  assert.match(source, /getWorkshopConfig/);
  assert.match(source, /saveWorkshopConfig/);
  assert.match(source, /listWorkshopTasks/);
  assert.match(source, /deleteWorkshopTasks/);
  assert.match(source, /小说获取 · 数据与清理/);
  assert.match(source, /正文自动清理/);
  assert.match(source, /1 ～ 30 天/);
  assert.match(source, /cleanup_enabled:\s*true/);
  assert.match(source, /retention_days:/);
  assert.match(source, /立即清除历史记录/);
  assert.match(source, /只删除历史元数据/);
  assert.match(source, /Modal\.confirm/);
});
