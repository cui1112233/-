const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('frontend/public/batch-rewrite/index.html', 'utf8');
const js = fs.readFileSync('frontend/public/batch-rewrite/app.js', 'utf8');

test('处理页默认收起提交设置并提供登录状态入口', () => {
  assert.doesNotMatch(html, /data-tab="siteSubmit"/);
  assert.match(html, /id="webLoginStatus"/);
  assert.doesNotMatch(html, /site-submit-connection/);
  assert.doesNotMatch(html, /id="webUsername"/);
  assert.doesNotMatch(html, /id="startSensitiveBtn"/);
  assert.doesNotMatch(html, /启动敏感词处理/);
  assert.match(js, /details\.open = false/);
  assert.match(js, /登录批量后台/);
  assert.match(js, /closest\("#webLoginStatus"\)/);
});

test('任务详情支持关闭与上一条下一条导航', () => {
  assert.match(js, /id="detailPrevBtn"/);
  assert.match(js, /id="detailNextBtn"/);
  assert.match(js, /id="detailCloseBtn"/);
  assert.match(js, /function adjacentTaskId/);
  assert.match(js, /document\.body\.classList\.add\("detail-modal-open"\)/);
  assert.match(html, /class="section task-detail-section"/);
});
