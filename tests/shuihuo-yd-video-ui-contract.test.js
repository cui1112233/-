const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const adminPage = read('frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx');
const batchModal = read('frontend/src/user/pages/shuihuo/BatchTaskModal.jsx');
const engineModal = read('frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx');
const drawer = read('frontend/src/user/pages/shuihuo/TaskDrawer.jsx');
const row = read('frontend/src/user/pages/shuihuo/StoryboardRow.jsx');

test('model catalog offers the fixed YD2.0 Mini image-to-video adapter without provider fields', () => {
  assert.match(adminPage, /value:\s*'yd_video',\s*label:\s*'YD2\.0 Mini 图生视频',\s*kind:\s*'video'/);
  assert.match(adminPage, /isYDVideoAdapter/);
  assert.match(adminPage, /固定服务商/);
  const ydBranch = adminPage.match(/isYDVideoAdapter \? <>([\s\S]*?)<\/> : null/);
  assert.ok(ydBranch, 'YD adapter must have its own provider-information branch');
  assert.doesNotMatch(ydBranch[1], /endpoint|requestTemplate|responseMapping/);
});

test('YD batch tasks retain their fixed request snapshot and use the saved engine mode', () => {
  assert.match(batchModal, /selectedModel\?\.adapterKind === 'yd_video'/);
  assert.match(batchModal, /videoSettings:\s*\{\s*aspectRatio:\s*videoAspectRatio\s*\}/);
  assert.match(batchModal, /固定 1 秒/);
  assert.match(batchModal, /仅可用于图生视频/);
  assert.match(batchModal, /productionConfig\?\.videoGenerationMode === 'text_to_video'/);
});

test('YD task controls allow a bound scene preset without a storyboard primary image', () => {
  for (const source of [batchModal, drawer]) {
    assert.doesNotMatch(source, /kind !== 'video' \|\| primaryImageSegmentIds\.has/);
    assert.doesNotMatch(source, /选择已确认且有主图片的分段/);
  }
  assert.doesNotMatch(row, /const canCreateVideo = videoReady && Boolean\(primaryImage\)/);
  assert.match(row, /const canCreateVideo = videoReady/);
  assert.match(row, /场景预设图或分镜主图片/);
});

test('YD engine controls report the image-to-video-only capability', () => {
  assert.match(engineModal, /selectedVideoModel\?\.adapterKind === 'yd_video'/);
  assert.match(engineModal, /YD2\.0 Mini 仅支持图生视频/);
  assert.match(engineModal, /videoGenerationMode/);
  assert.match(engineModal, /value: 'image_to_video', label: '图生视频'/);
  assert.match(engineModal, /value: 'text_to_video', label: '文生视频'/);
});
