const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('frontend/src/user/pages/BatchFactoryPage.jsx', 'utf8');
const layout = fs.readFileSync('frontend/src/shared/layouts/UserLayout.jsx', 'utf8');
const shuihuo = fs.readFileSync('frontend/src/user/pages/shuihuo/ProjectsView.jsx', 'utf8');

test('batch factory exposes the four-zone workbench shell', () => {
  for (const marker of [
    'batch-factory-workbench',
    'batch-factory-status-center',
    'batch-factory-novel-list',
    'batch-factory-right-rail',
    '待合并',
    '已合并'
  ]) assert.match(page, new RegExp(marker));
});

test('shuihuo and batch factory remain adjacent creation tools', () => {
  const shuihuoIndex = layout.indexOf("href: '/shuihuo-production'");
  const batchIndex = layout.indexOf("href: '/batch-factory'");
  assert.ok(shuihuoIndex >= 0 && batchIndex >= 0);
  assert.ok(Math.abs(shuihuoIndex - batchIndex) < 500);
});

test('shuihuo creation header exposes batch factory beside comic creation', () => {
  assert.match(shuihuo, /创作漫剧/);
  assert.match(shuihuo, /onOpenBatchFactory/);
  assert.match(shuihuo, /批量工厂/);
});
