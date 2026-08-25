const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('model services live in account API configuration while local executor lives in settings', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  const apiConfig = read('frontend/src/user/pages/ApiConfigPage.jsx');

  assert.doesNotMatch(settings, /settings-model-services/);
  assert.doesNotMatch(settings, /name=\{\['video', 'apiKey'\]\}/);
  assert.match(settings, /工作台与 CM/);
  assert.match(settings, /服务器归档文件夹/);
  assert.match(settings, /豆包本地执行器/);
  assert.match(settings, /local-executors/);
  assert.match(settings, /settings-executor-section/);
  assert.match(apiConfig, /文本模型连接/);
  assert.match(apiConfig, /生图服务/);
  assert.match(apiConfig, /视频生成服务/);
  assert.doesNotMatch(apiConfig, /豆包本地执行器|本机视频执行通道|local-executors/);
});

test('model service rows use divider layout and stack below 700px', () => {
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(css, /\.model-service-row\s*\{[\s\S]*?border-top:\s*1px solid var\(--legacy-border\)/);
  assert.match(css, /@container \(max-width: 700px\)[\s\S]*?\.model-service-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
