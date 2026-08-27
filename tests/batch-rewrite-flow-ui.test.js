const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/app.js'), 'utf8');

test('流程页面只保留处理页敏感词 AI 开关，并从设置页移除旧执行开关', () => {
  assert.match(html, /id="sensitiveAiProcessEnabled"/);
  assert.doesNotMatch(html, /id="sensitiveAiEnabled"/);
  assert.doesNotMatch(html, /id="webEnabled"/);
  assert.match(html, /id="openWebSubmitBtn"[^>]*>提交网络</);
});

test('任务按钮调用直接提交流程而不是打开设置页', () => {
  assert.match(app, /function openWebSubmitFromTasks\(\)\s*\{[\s\S]*?submitWebSubmit\("selected"\)/);
});

test('提交方式内提供组织归属下拉，配置同步工具位于该区块外', () => {
  const submitCard = html.indexOf('site-submit-card site-submit-configuration');
  const syncTools = html.indexOf('id="webSubmitSyncTools"');
  const organization = html.indexOf('id="webOrganization"');
  assert.ok(syncTools >= 0 && syncTools < submitCard);
  assert.ok(organization > submitCard);
  assert.match(html, /请选择组织归属/);
  assert.match(app, /function renderWebOrganizationOptions\(/);
  assert.match(app, /selected_organization/);
});

test('网站提交只保留版本配置，不再展示自由配置入口', () => {
  assert.doesNotMatch(html, /value="free"/);
  assert.doesNotMatch(html, /id="webFreeConfigSection"/);
  assert.match(html, /<strong>版本配置<\/strong>/);
  assert.match(app, /function webSubmitModeFromForm\(\)\s*\{\s*return "version"/);
});

test('嵌入工作台的登录失效会通知父页面并显示中文提示', () => {
  assert.match(app, /response\.status === 401/);
  assert.match(app, /type:\s*["']qiantie:auth-expired["']/);
  assert.match(app, /登录已失效，请重新登录/);
});
