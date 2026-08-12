const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const api = read('frontend/src/shared/api/shuihuoProduction.js');
const page = read('frontend/src/user/pages/ShuihuoProductionPage.jsx');
const studio = read('frontend/src/user/pages/shuihuo/StudioView.jsx');
const drawer = read('frontend/src/user/pages/shuihuo/TaskDrawer.jsx');
const admin = read('frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx');

test('production page loads the server readiness snapshot and renders its dependency strip', () => {
  assert.match(api, /export (?:async )?function getProductionHealth\([\s\S]*?\/health/);
  assert.match(page, /getProductionHealth/);
  assert.match(page, /shuihuo-readiness-strip/);
  for (const dependency of ['Redis', '存储', '文本模型', '图片模型', '视频模型']) {
    assert.match(page, new RegExp(dependency));
  }
});

test('production actions stay available only when their actual dependencies are ready', () => {
  assert.doesNotMatch(page, /createProject[\s\S]{0,140}readiness/);
  assert.match(studio, /textReady/);
  assert.match(studio, /taskReady/);
  assert.match(studio, /disabled:\s*!textReady/);
  assert.match(studio, /disabled=\{!confirmed \|\| !taskReady\}/);
});

test('task drawer presents backend task and provider states without fabricated progress', () => {
  for (const state of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    assert.match(drawer, new RegExp(state));
  }
  assert.match(drawer, /providerTaskId/);
  assert.match(drawer, /errorCode/);
  assert.match(drawer, /errorMessage/);
  assert.match(drawer, /completedMedia/);
  assert.doesNotMatch(drawer, /progress\s*[:=]/i);
  assert.doesNotMatch(drawer, /百分比/);
});

test('admin catalog reports configuration safely without private provider fields', () => {
  assert.match(admin, /credentialConfigured/);
  assert.match(admin, /providerConfigured/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]credentialRef['"]/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]endpoint['"]/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]requestTemplate['"]/);
});
