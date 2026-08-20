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
  assert.match(page, /流水线/);
  assert.match(page, /任务中心/);
  assert.match(page, /规则排版/);
  assert.match(page, /知识库/);
  assert.match(page, /配置/);
  assert.match(page, /processBatch/);
  assert.match(page, /startWorkshopProcess/);
  assert.match(page, /retryWorkshopTasks/);
  assert.match(page, /restoreWorkshopOriginal/);
  assert.match(page, /listWorkshopTasks/);
  const entry = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(entry, /改文工作台/);
  assert.match(entry, /novel-fetch-workshop/);
  const api = read('frontend/src/shared/api/novelFetchWorkshop.js');
  assert.match(api, /api\/novel-fetch-workshop\/process/);
  assert.match(api, /api\/novel-fetch-workshop\/tasks/);
  assert.match(api, /api\/novel-fetch-workshop\/config/);
});

test('工作台加入上传与版本选择契约', () => {
  const page = read('frontend/src/user/pages/NovelFetchWorkshopPage.jsx');
  assert.match(page, /加入上传/);
  assert.match(page, /workshopUploadItems/);
  const nf = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(nf, /workshopUploadItems/);
  assert.match(nf, /version/);
});

test('上传路由注入 workshopTasks 且上传面板放开 workshop 门槛', () => {
  const app = read('app.js');
  assert.match(app, /createNovelFetchUploadRouter\(\{ store: resolvedNovelFetchStore, workshopTasks: resolvedWorkshopTasks \}\)/);
  const nf = read('frontend/src/user/pages/NovelFetchPage.jsx');
  // 对接上传按钮：本页无已处理小说但存在 workshop 项时仍可打开
  assert.match(nf, /uploadItems\.every\(i => i\.source !== 'workshop'\)/);
  assert.match(nf, /uploadItems\.some\(i => i\.source === 'workshop'\)/);
  // 上传表格按 bookId+source 复合键匹配，避免同 bookId 双 source 行互相影响
  assert.match(nf, /String\(i\.bookId\) === String\(row\.bookId\) && \(i\.source \|\| ''\) === \(row\.source \|\| ''\)/);
});
