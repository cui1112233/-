const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'SettingsPage.jsx'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'shared', 'api', 'novelFetchWorkshop.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-fetch-workshop.js'), 'utf8');

test('settings exposes novel fetch data and cleanup controls on the existing settings page', () => {
  assert.match(settingsSource, /getWorkshopConfig/);
  assert.match(settingsSource, /saveWorkshopConfig/);
  assert.match(settingsSource, /listWorkshopTasks/);
  assert.match(settingsSource, /deleteWorkshopTasks/);
  assert.match(settingsSource, /小说获取 · 数据与清理/);
  assert.match(settingsSource, /正文自动清理/);
  assert.match(settingsSource, /1 ～ 30 天/);
  assert.match(settingsSource, /cleanup_enabled:\s*true/);
  assert.match(settingsSource, /retention_days:/);
  assert.match(settingsSource, /立即清除历史记录/);
  assert.match(settingsSource, /只删除历史元数据/);
  assert.match(settingsSource, /Modal\.confirm/);
});

test('settings capacity status comes from the signed body store status bridge', () => {
  assert.match(routeSource, /createNovelFetchLifecycleClient/);
  assert.match(routeSource, /router\.get\('\/storage\/status'/);
  assert.match(apiSource, /getWorkshopStorageStatus/);
  assert.match(settingsSource, /getWorkshopStorageStatus/);
  assert.match(settingsSource, /容量状态/);
  assert.match(settingsSource, /实际存储/);
  assert.match(settingsSource, /可安全释放/);
  assert.match(settingsSource, /已到期/);
});
