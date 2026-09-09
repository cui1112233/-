const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('entity editor offers AI generation and local upload without URL pasting', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /type === 'characters' \? '生成人物图片' : '生成场景图片'/);
  assert.match(source, /上传图片/);
  assert.match(source, /generateReferenceAsset/);
  assert.match(source, /uploadReferenceAsset/);
  assert.match(source, /mergeEntityImageState/);
  assert.doesNotMatch(source, /粘贴 HTTPS 图片地址/);
  assert.doesNotMatch(source, /添加图片/);
  assert.doesNotMatch(source, /addImageCandidate/);
  assert.doesNotMatch(source, /newImageUrl/);
});

test('entity editor can remove an individual image without deleting the entity', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /removeEntityImage/);
  assert.match(source, /删除这张图片/);
  assert.match(source, /Popconfirm/);
  assert.match(source, /onChange\(fields, next\)/);
});

test('entity cards expose image-backed status without inventing a placeholder image', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /imageUrls\.length/);
  assert.match(source, /mainImageUrl/);
  assert.doesNotMatch(source, /给人物或场景添加 HTTPS 图片并选择主图后/);
});
