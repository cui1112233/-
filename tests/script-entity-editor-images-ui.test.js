import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('entity image panel defines the double-column image controls', () => {
  const component = read('frontend/src/user/components/EntityImagePanel.jsx');
  const styles = read('frontend/src/shared/styles/global.css');

  assert.match(component, /entity-editor-image-panel/);
  assert.match(component, /主图预览/);
  assert.match(component, /上传图片/);
  assert.match(component, /AI生成/);
  assert.match(component, /type="file"/);
  assert.match(component, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(component, /entity-editor-image-thumbnail/);
  assert.match(component, /删除图片/);
  assert.match(component, /loadReferenceAssetImage/);
  assert.match(component, /URL\.createObjectURL/);
  assert.match(component, /URL\.revokeObjectURL/);
  assert.match(component, /if \(!active \|\| generation !== previewGeneration\.current\)/);
  assert.match(component, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.doesNotMatch(component, /<span\s+[^>]*role="button"/);
  assert.match(component, /entity-editor-image-delete-control/);
  assert.match(styles, /\.entity-editor-layout/);
  assert.match(styles, /\.entity-editor-image-panel/);
});

test('entity image panel defines the empty state and image API contracts', () => {
  const component = read('frontend/src/user/components/EntityImagePanel.jsx');

  assert.match(component, /暂无主图/);
  assert.match(component, /entity-editor-image-empty/);
  assert.match(component, /uploadReferenceAsset/);
  assert.match(component, /generateReferenceAsset/);
  assert.match(component, /selectEntityImage/);
  assert.match(component, /removeEntityImage/);
  assert.match(component, /data_url/);
  assert.match(component, /novel_text/);
});
