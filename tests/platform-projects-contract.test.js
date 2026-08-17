const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('platform projects aggregate script history, novel panel, and water production without copying their data', () => {
  const app = read('app.js');
  const route = read('routes/platform-projects.js');

  assert.match(app, /app\.use\('\/api\/platform-projects', createPlatformProjectsRouter/);
  assert.match(route, /createNovelPanelStore/);
  assert.match(route, /readHistoryIndex/);
  assert.match(route, /listShuihuoProjects/);
  assert.match(route, /kind: 'novel-panel'/);
  assert.match(route, /kind: 'shuihuo-production'/);
  assert.match(route, /route: `\/novel-panel\?project=/);
  assert.match(route, /route: `\/shuihuo-production\?project=/);
  assert.match(route, /function usableTimestamp/);
});

test('home and history use the shared platform project index', () => {
  const home = read('frontend/src/user/pages/HomePage.jsx');
  const history = read('frontend/src/user/pages/HistoryPage.jsx');

  assert.match(home, /listPlatformProjects/);
  assert.match(home, /\/history\?entry=/);
  assert.match(history, /listPlatformProjects/);
  assert.match(history, /entry\.kind === 'script-history'/);
  assert.match(history, /window\.location\.href = entry\.route/);
});

test('brand and project deeplinks return users to the expected platform workspace', () => {
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const shuihuo = read('frontend/src/user/pages/ShuihuoProductionPage.jsx');
  const novelPanel = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const workbench = read('public/novel-panel/workbench/app.js');

  assert.match(layout, /<Link href="\/" className="legacy-brand-link">/);
  assert.match(shuihuo, /new URLSearchParams\(window\.location\.search\)\.get\('project'\)/);
  assert.match(novelPanel, /searchParams\.get\('project'\)/);
  assert.match(workbench, /qiantieRequestedProject/);
});
