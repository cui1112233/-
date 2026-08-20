const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const adminPage = read('frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx');
const batchModal = read('frontend/src/user/pages/shuihuo/BatchTaskModal.jsx');
const engineModal = read('frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx');

test('model catalog offers the fixed YD2.0 Mini image-to-video adapter without provider fields', () => {
  assert.match(adminPage, /value:\s*'yd_video',\s*label:\s*'YD2\.0 Mini 图生视频',\s*kind:\s*'video'/);
  assert.match(adminPage, /isYDVideoAdapter/);
  assert.match(adminPage, /固定服务商/);
  const ydBranch = adminPage.match(/isYDVideoAdapter \? <>([\s\S]*?)<\/> : null/);
  assert.ok(ydBranch, 'YD adapter must have its own provider-information branch');
  assert.doesNotMatch(ydBranch[1], /endpoint|requestTemplate|responseMapping/);
});

test('YD batch tasks submit an aspect-ratio snapshot and expose only fixed supported controls', () => {
  assert.match(batchModal, /selectedModel\?\.adapterKind === 'yd_video'/);
  assert.match(batchModal, /videoSettings:\s*\{\s*aspectRatio:\s*videoAspectRatio\s*\}/);
  assert.match(batchModal, /const YD_VIDEO_RATIOS = \['9:16', '16:9'\]/);
  assert.match(batchModal, /固定 1 秒/);
  assert.match(batchModal, /固定 720p/);
  const ydBranch = batchModal.match(/isYDVideoModel \? <>([\s\S]*?)<\/> : null/);
  assert.ok(ydBranch, 'YD model must have a dedicated batch-controls branch');
  assert.doesNotMatch(ydBranch[1], /1:1|5秒|8秒|10秒/);
});

test('YD engine controls retain only its fixed capability envelope', () => {
  assert.match(engineModal, /selectedVideoModel\?\.adapterKind === 'yd_video'/);
  assert.match(engineModal, /固定 1 秒/);
  assert.match(engineModal, /固定 720p/);
  assert.match(engineModal, /const YD_VIDEO_RATIOS = \['9:16', '16:9'\]/);
  const ydBranch = engineModal.match(/isYDVideoModel \? <>([\s\S]*?)<\/> : </);
  assert.ok(ydBranch, 'YD model must have a dedicated engine-controls branch');
  assert.doesNotMatch(ydBranch[1], /1:1|5秒|8秒|10秒/);
});
