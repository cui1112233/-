const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('shot reference UI shows name tags instead of image thumbnails', () => {
  const source = read('frontend/src/user/components/ShotOutputCards.jsx');
  assert.match(source, /reference\.label/);
  assert.match(source, /reference\.url/);
  assert.match(source, /Star/);
  assert.match(source, /shot-reference-tag/);
  assert.doesNotMatch(source, /AntImage/);
});

test('entity reference thumbnails remain zoomable while shot cards use name tags', () => {
  const editorSource = read('frontend/src/user/pages/ScriptPage.jsx');
  const shotSource = read('frontend/src/user/components/ShotOutputCards.jsx');
  assert.match(editorSource, /Image as AntImage/);
  assert.match(editorSource, /<AntImage[\s\S]*preview/);
  assert.doesNotMatch(shotSource, /Image as AntImage/);
  assert.match(shotSource, /aria-pressed/);
});

test('shot reference tags have individual star states without a total switch', () => {
  const shotSource = read('frontend/src/user/components/ShotOutputCards.jsx');
  const pageSource = read('frontend/src/user/pages/ScriptPage.jsx');
  const styles = read('frontend/src/shared/styles/global.css');
  assert.doesNotMatch(shotSource, /Switch/);
  assert.doesNotMatch(shotSource, /onToggleReferenceImages/);
  assert.doesNotMatch(shotSource, /referenceState\.enabled/);
  assert.doesNotMatch(pageSource, /onToggleReferenceImages=/);
  assert.match(shotSource, /is-active/);
  assert.match(shotSource, /is-inactive/);
  assert.match(shotSource, /onToggleReferenceImage/);
  assert.match(styles, /\.shot-reference-tag\.is-active/);
  assert.match(styles, /\.shot-reference-tag\.is-inactive/);
});

test('shot reference thumbnails are visible whenever a shot has image-backed matches', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /showReferenceControls=\{true\}/);
  assert.doesNotMatch(source, /showReferenceControls=\{scriptVideoModelKey === 'minimax-h3-video'\}/);
});

test('collector excludes entities without generated main images', async () => {
  const { collectShotReferenceDescriptors } = await import('../frontend/src/user/pages/scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '林悦走进医院急诊走廊',
    extractInfo: {
      characters: [{ id: 'c1', data: { 名称: '林悦' }, mainImageUrl: 'https://img.example/lin.png' }],
      scenes: [{ id: 's1', data: { 名称: '医院急诊走廊' } }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['林悦']);
});

test('collector falls back to all image-backed entities when a shot uses a generic description', async () => {
  const { collectShotReferenceDescriptors } = await import('../frontend/src/user/pages/scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '一名年轻的程序员坐在电脑前，神色专注。',
    extractInfo: {
      characters: [{ id: 'c1', data: { 名称: '陈禹' }, mainImageUrl: 'https://img.example/chen.png' }],
      scenes: [{ id: 's1', data: { 名称: '研发部工位' }, mainImageUrl: 'https://img.example/desk.png' }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['陈禹', '研发部工位']);
});

test('collector matches character aliases and legacy name fields', async () => {
  const { collectShotReferenceDescriptors } = await import('../frontend/src/user/pages/scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '小陈走进研发部工位。',
    extractInfo: {
      characters: [{ id: 'c1', data: { 名称: '陈禹', 别名: '小陈' }, mainImageUrl: 'https://img.example/chen.png' }],
      scenes: [{ id: 's1', data: { 场景: '研发部工位' }, mainImageUrl: 'https://img.example/desk.png' }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['陈禹', '研发部工位']);
});

test('collector keeps string entity records compatible', async () => {
  const { collectShotReferenceDescriptors } = await import('../frontend/src/user/pages/scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '林悦抬头。',
    extractInfo: {
      characters: [{ data: '林悦', mainImageUrl: 'https://img.example/lin.png' }]
    }
  });
  assert.deepEqual(refs.map(item => item.label), ['林悦']);
});

test('legacy shot-level switch state no longer disables every reference tag', async () => {
  const { collectShotReferenceDescriptors } = await import('../frontend/src/user/pages/scriptVideoReferences.js');
  const refs = collectShotReferenceDescriptors({
    shotText: '林悦抬头。',
    extractInfo: {
      characters: [{ id: 'c1', data: { 名称: '林悦' }, mainImageUrl: 'https://img.example/lin.png' }]
    },
    shotReferenceStates: { 0: { enabled: false } }
  });
  assert.deepEqual(refs.map(item => item.label), ['林悦']);
});

test('does not render empty reference controls when no generated image matches', () => {
  const source = read('frontend/src/user/components/ShotOutputCards.jsx');
  assert.match(source, /showReferenceControls && references\.length/);
  assert.doesNotMatch(source, /当前分镜暂无已生成参考图/);
  assert.doesNotMatch(source, /可先在左侧人物或场景中添加图片/);
});
