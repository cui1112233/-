const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('改文工作台前端契约', () => {
  const app = read('frontend/src/user/App.jsx');
  assert.match(app, /novel-fetch-workshop/);
  assert.match(app, /NovelFetchWorkshopPage/);
  const page = read('frontend/src/user/pages/NovelFetchWorkshopPage.jsx');
  assert.match(page, /改文工作台/);
  assert.match(page, /Tabs/);
  assert.match(page, /处理/);
  assert.match(page, /任务/);
  assert.match(page, /配置/);
  assert.match(page, /processBatch/);
  assert.match(page, /listWorkshopTasks/);
  const entry = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(entry, /改文工作台/);
  assert.match(entry, /novel-fetch-workshop/);
  const api = read('frontend/src/shared/api/novelFetchWorkshop.js');
  assert.match(api, /api\/novel-fetch-workshop\/process/);
  assert.match(api, /api\/novel-fetch-workshop\/tasks/);
  assert.match(api, /api\/novel-fetch-workshop\/config/);
});
