const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('novel fetch backend route is wired and validates input', () => {
  const app = read('app.js');
  const pages = read('routes/pages.js');
  const route = read('routes/novel-fetch.js');

  assert.match(app, /createNovelFetchRouter\(\{ presetStore: resolvedPresetStore \}\)/);
  assert.match(pages, /router\.get\('\/novel-fetch', serveReactEntry\('index\.html', 'index\.html'\)\)/);
  assert.match(route, /createNovelFetchRouter/);
  assert.match(route, /platformNameById/);
  assert.match(route, /const numericPlatform = Number\(platform\)/);
  assert.match(route, /bookIds\.length > MAX_BOOK_IDS/);
  assert.match(route, /\\d\{1,20\}/);
  assert.match(route, /numericMaxTxt < 100 \|\| numericMaxTxt > 100000/);
  assert.match(route, /upstream\.code === 200/);
  assert.match(route, /status: 'ok'/);
  assert.match(route, /status: 'error'/);
});

test('novel fetch page exposes platform options, batch ids, word count, and actions', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  const api = read('frontend/src/shared/api/novelFetch.js');
  const app = read('frontend/src/user/App.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');

  const names = ['黑岩付费', '番茄付费', '七猫付费', '点众付费', '番茄免费', '知乎付费', '掌阅付费', '卓越付费', '九州书城', '掌文付费'];
  const ids = [1, 2, 3, 4, 7, 15, 20, 26, 29, 31];
  for (let i = 0; i < names.length; i++) {
    assert.match(page, new RegExp(`id: ${ids[i]}, name: '${names[i]}'`));
  }
  assert.match(page, /parseBookIds/);
  assert.match(page, /split\(\/\[\\s,，;；\]\+\/\)/);
  assert.match(page, /WORD_COUNTS/);
  assert.match(page, /value: 'custom'/);
  assert.match(page, /fetchNovelContent/);
  assert.match(page, /全选/);
  assert.match(page, /批量复制/);
  assert.match(page, /批量下载/);
  assert.match(page, />查看</);
  assert.match(page, />下载</);
  assert.match(page, />重试</);
  assert.match(page, /novel-fetch-status--\$\{row\.status\}/);
  assert.match(api, /fetchNovelContent/);
  assert.match(api, /\/api\/novel-fetch/);
  assert.match(app, /'\/novel-fetch': NovelFetchPage/);
  assert.match(layout, /href: '\/novel-fetch'/);
  assert.match(layout, /icon: BookOpen/);
});
