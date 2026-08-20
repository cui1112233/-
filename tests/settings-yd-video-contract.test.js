const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('settings orders text, image, and fixed YD video services without editable video endpoint fields', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');

  const textIndex = settings.indexOf('<h3>文本推理</h3>');
  const imageIndex = settings.indexOf('<h3>图片生成</h3>');
  const videoIndex = settings.indexOf('<h3>视频生成</h3>');
  assert.ok(textIndex >= 0, 'missing text inference service label');
  assert.ok(imageIndex > textIndex, 'image service must follow text inference');
  assert.ok(videoIndex > imageIndex, 'video service must follow image generation');

  assert.match(settings, /name=\{\['video', 'apiKey'\]\}/);
  assert.match(settings, /<Input\.Password[^>]*placeholder="留空表示不修改已保存的 Key"/);
  assert.match(settings, /config\.video\?\.hasApiKey/);
  assert.match(settings, /video:\s*\{\s*apiKey: values\.video\?\.apiKey \|\| ''\s*\}/);
  assert.match(settings, /form\.setFieldValue\(\['video', 'apiKey'\], ''\)/);
  assert.match(settings, /中转亚迪/);
  assert.match(settings, /YD2\.0 Mini/);
  assert.match(settings, /720p/);
  assert.match(settings, /1 秒/);
  assert.match(settings, /已配置/);
  assert.match(settings, /未配置/);

  const videoSection = settings.slice(videoIndex, settings.indexOf('</section>', videoIndex));
  assert.doesNotMatch(videoSection, /Base URL/);
  assert.doesNotMatch(videoSection, /测试.*视频.*连接/);
  assert.doesNotMatch(videoSection, /name=\{\['video', '(?:provider|baseUrl|model|duration|resolution)'\]\}/);
});

test('model service rows use divider layout and stack below 700px', () => {
  const css = read('frontend/src/shared/styles/global.css');

  assert.match(css, /\.model-service-row\s*\{[\s\S]*?border-top:\s*1px solid var\(--legacy-border\)/);
  assert.match(css, /@container \(max-width: 700px\)[\s\S]*?\.model-service-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
