import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('entity editor uses a double-column image asset panel instead of pasted image URLs', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const panel = read('frontend/src/user/components/EntityImagePanel.jsx');
  const styles = read('frontend/src/shared/styles/global.css');

  assert.match(page, /EntityImagePanel/);
  assert.doesNotMatch(page, /粘贴 HTTPS 图片地址/);
  assert.match(panel, /主图预览/);
  assert.match(panel, /上传图片/);
  assert.match(panel, /AI生成/);
  assert.match(panel, /点击放大/);
  assert.match(panel, /删除图片/);
  assert.match(panel, /loadReferenceAssetImage/);
  assert.match(styles, /\.entity-editor-layout/);
  assert.match(styles, /\.entity-editor-image-panel/);
});
