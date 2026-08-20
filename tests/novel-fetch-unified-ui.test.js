const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('小说获取固定提供七个工作页签及实际面板', () => {
  const source = read('frontend/src/user/pages/NovelFetchPage.jsx');
  const tabs = [
    ['process', '处理'], ['tasks', '任务'], ['config', '配置'], ['knowledge', '知识库'],
    ['rules', '处理规则'], ['submit', '网站提交'], ['logs', '日志']
  ];

  for (const [key, label] of tabs) {
    assert.match(source, new RegExp(`key:\\s*['\"]${key}['\"]`));
    assert.match(source, new RegExp(label));
    assert.match(source, /children: panels\[item\.key\]/);
  }
  assert.match(source, /<Tabs/);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(source, /window\.history\.replaceState/);
});

test('小说获取各工作面板复用既有 API', () => {
  const source = read('frontend/src/user/pages/NovelFetchPage.jsx');
  for (const api of [
    'fetchNovelContent', 'listWorkshopTasks', 'getWorkshopTask', 'retryWorkshopTasks',
    'getWorkshopConfig', 'saveWorkshopConfig', 'getWorkshopKnowledge', 'saveWorkshopKnowledge',
    'previewWorkshopRules', 'suggestWorkshopRules', 'getWebSubmitConfig', 'startWebSubmit'
  ]) assert.match(source, new RegExp(api));

  for (const label of ['开始处理', '批量重试', '保存配置', '新增条目', '预览规则', '提交预览', '操作日志']) {
    assert.match(source, new RegExp(label));
  }
});

test('小说获取页面不承担改文工作台入口调整', () => {
  const source = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.doesNotMatch(source, /window\.location\.(href|replace)\s*=\s*['\"]\/novel-fetch-workshop/);
  assert.doesNotMatch(source, /进入改文工作台/);
});

test('统一页面样式包含工作台与响应式面板布局', () => {
  const css = read('frontend/src/user/pages/novel-fetch.css');
  for (const className of ['novel-fetch-workbench', 'novel-fetch-summary', 'novel-fetch-grid', 'novel-fetch-panel', 'novel-fetch-compare']) {
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.match(css, /@media/);
});
