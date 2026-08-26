const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = [
  fs.readFileSync('frontend/src/user/pages/BatchFactoryPage.jsx', 'utf8'),
  fs.readFileSync('frontend/src/user/pages/BatchFactoryPreviewPage.jsx', 'utf8')
].join('\n');
const layout = fs.readFileSync('frontend/src/shared/layouts/UserLayout.jsx', 'utf8');
const shuihuo = fs.readFileSync('frontend/src/user/pages/shuihuo/ProjectsView.jsx', 'utf8');
const pageSource = fs.readFileSync('frontend/src/user/pages/BatchFactoryPage.jsx', 'utf8');
const workbenchCss = fs.readFileSync('frontend/src/user/pages/batch-factory-workbench.css', 'utf8');

test('screenshot workbench title bar exposes title and return action', () => {
  assert.match(page, /批量工厂/);
  assert.match(page, /返回水货生产/);
  assert.match(page, /href:\s*['\"]\/shuihuo-production['\"]|location(?:\.href)?\s*=\s*['\"]\/shuihuo-production['\"]/);
  assert.match(page, /batch-factory-page-header|batch-factory-topbar/);
});

test('batch factory renders the real workbench instead of returning the static preview', () => {
  const source = fs.readFileSync('frontend/src/user/pages/BatchFactoryPage.jsx', 'utf8');
  assert.doesNotMatch(source, /return\s+<BatchFactoryPreviewPage\s*\/>/);
  assert.match(source, /getBatchFactoryBatch/);
});

test('screenshot workbench batch action bar exposes production and publish tabs', () => {
  assert.match(page, /batch-factory-action-bar/);
  assert.match(page, /生产统一设置/);
  assert.match(page, /发布统一设置/);
  assert.match(page, /production[^\n]*tab|tab[^\n]*production/i);
  assert.match(page, /publish[^\n]*tab|tab[^\n]*publish/i);
});

test('screenshot workbench status center includes abnormal summary', () => {
  assert.match(page, /batch-factory-status-center/);
  assert.match(page, /异常/);
  assert.match(page, /batch-factory-abnormal-summary/);
});

test('status center locates matching novels without filtering the book list', () => {
  const source = fs.readFileSync('frontend/src/user/pages/BatchFactoryPage.jsx', 'utf8');
  assert.match(source, /function locateStatus\(key\)/);
  assert.match(source, /scrollIntoView/);
  assert.doesNotMatch(source, /matchesStatus\s*=\s*workbenchStatus/);
});

test('screenshot workbench keeps three-column regions', () => {
  assert.match(page, /batch-factory-workbench-grid/);
  assert.match(page, /batch-factory-novel-list/);
  assert.match(page, /batch-factory-center/);
  assert.match(page, /batch-factory-right-rail/);
});

test('VIDEO operations live in the selected-book column rather than a fourth workbench column', () => {
  assert.doesNotMatch(pageSource, /<aside className="batch-factory-video-operations"/);
  assert.match(pageSource, /batch-factory-selected-video-operations/);
  assert.match(workbenchCss, /grid-template-columns:\s*var\(--bf-list-width\) 6px minmax\(0, 1fr\) 6px var\(--bf-rail-width\)/);
});

test('status center derives book state separately from VIDEO progress and keeps publishing unavailable', () => {
  assert.match(pageSource, /function deriveBatchFactoryStatus\(item,/);
  assert.match(pageSource, /function summarizeBatchFactoryVideoProgress\(items,/);
  assert.match(pageSource, /视频生成中/);
  assert.match(pageSource, /发布统一设置（待接通）/);
});

test('screenshot workbench right rail exposes video progress ring', () => {
  assert.match(page, /视频生成进度/);
  assert.match(page, /batch-factory-video-progress-ring/);
  assert.match(page, /VIDEO/);
});

test('screenshot workbench right rail exposes bulk merge section', () => {
  assert.match(page, /batch-factory-bulk-merge/);
  assert.match(page, /批量合并|合并待合并/);
});

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

test('batch factory sits directly after water production in global navigation', () => {
  const shuihuoIndex = layout.indexOf("href: '/shuihuo-production'");
  const batchIndex = layout.indexOf("href: '/batch-factory'");
  assert.ok(shuihuoIndex >= 0);
  assert.ok(batchIndex > shuihuoIndex);
  assert.ok(batchIndex - shuihuoIndex < 320);
});

test('shuihuo creation header exposes batch factory beside comic creation', () => {
  assert.match(shuihuo, /创作漫剧/);
  assert.match(shuihuo, /onOpenBatchFactory/);
  assert.match(shuihuo, /批量工厂/);
});
