const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'index.html');
const feedbackPath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'interaction-feedback.js');
const pageHtml = fs.readFileSync(pagePath, 'utf8');

test('小说获取主工作台加载独立的可见交互反馈层', () => {
  assert.match(pageHtml, /interaction-feedback\.js/);
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须随公网工作台发布');
});

test('开始处理和提交网络点击后立即给出进行中反馈', () => {
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须存在');
  const source = fs.readFileSync(feedbackPath, 'utf8');
  assert.match(source, /processBtn/);
  assert.match(source, /openWebSubmitBtn/);
  assert.match(source, /openWebSubmitFromTasks/);
  assert.match(source, /正在处理|正在提交/);
  assert.match(source, /aria-busy/);
});

test('局部状态错误、Promise 异常和页面异常必须升级成明显错误提示', () => {
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须存在');
  const source = fs.readFileSync(feedbackPath, 'utf8');
  assert.match(source, /MutationObserver/);
  assert.match(source, /processResult/);
  assert.match(source, /siteSubmitStatus/);
  assert.match(source, /batchStatus/);
  assert.match(source, /unhandledrejection/);
  assert.match(source, /addEventListener\(['"]error['"]/);
  assert.match(source, /role['"],\s*['"]alert['"]|role\s*=\s*['"]alert['"]/);
});
