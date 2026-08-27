const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('API config exposes independent save actions for text, image, and video modes', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ApiConfigPage.jsx'), 'utf8');
  assert.match(page, /保存文本模型/);
  assert.match(page, /保存生图配置/);
  assert.match(page, /保存视频生成/);
  assert.match(page, /saveText/);
  assert.match(page, /saveImage/);
  assert.match(page, /saveVideo/);
});
