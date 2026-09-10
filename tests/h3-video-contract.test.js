const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getDefaultVideoModels,
  H3_MODEL_KEY,
  H3_NO_IMAGE_WORKFLOW,
  H3_REFERENCE_WORKFLOW,
  getUnifiedVideoModels,
  selectH3Workflow
} = require('../lib/video-model-catalog');

test('default catalog keeps the existing video entries and adds one redacted H3 entry', () => {
  const result = getDefaultVideoModels({ h3Configured: false });
  assert.deepEqual(result.map(model => model.key), [
    'yd2-mini-video',
    'local-doubao-executor-video',
    H3_MODEL_KEY
  ]);
  assert.equal(result.find(model => model.key === H3_MODEL_KEY).configured, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.find(model => model.key === H3_MODEL_KEY), 'apiKey'), false);
});

test('H3 automatically selects the no-image workflow when no usable reference image exists', () => {
  assert.equal(selectH3Workflow(), H3_NO_IMAGE_WORKFLOW);
  assert.equal(selectH3Workflow([]), H3_NO_IMAGE_WORKFLOW);
  assert.equal(selectH3Workflow(['', '   ']), H3_NO_IMAGE_WORKFLOW);
});

test('H3 automatically selects the reference-image workflow when an image URL exists', () => {
  assert.equal(selectH3Workflow(['https://cdn.example.test/reference.png']), H3_REFERENCE_WORKFLOW);
});

test('unified video catalog exposes one redacted H3 model with 15 second capability', () => {
  const result = getUnifiedVideoModels({
    models: [
      { id: 1, name: 'YD2.0 Mini', kind: 'video', adapterKind: 'yd_video', maxVideoDuration: 1 },
      { id: 2, name: '本地豆包执行器', kind: 'video', adapterKind: 'local_executor_video', maxVideoDuration: 10 }
    ],
    h3Configured: false
  });
  const h3 = result.find(model => model.key === H3_MODEL_KEY);
  assert.ok(h3);
  assert.equal(h3.kind, 'video');
  assert.equal(h3.adapterKind, 'autodl_comfyui_video');
  assert.equal(h3.maxVideoDuration, 15);
  assert.equal(h3.configured, false);
  assert.equal(h3.requiresImageInput, false);
  assert.equal(h3.workflow.noImage, H3_NO_IMAGE_WORKFLOW);
  assert.equal(h3.workflow.referenceImages, H3_REFERENCE_WORKFLOW);
  assert.deepEqual(h3.supportedResolutions, ['480p', '768p']);
  assert.equal(Object.prototype.hasOwnProperty.call(h3, 'apiKey'), false);
});

test('unified video catalog replaces duplicate H3 entries without changing other models', () => {
  const result = getUnifiedVideoModels({
    models: [
      { id: 1, key: H3_MODEL_KEY, name: '旧 H3', kind: 'video', adapterKind: 'yd_video' },
      { id: 2, name: '文本模型', kind: 'text' }
    ],
    h3Configured: true
  });
  assert.equal(result.filter(model => model.key === H3_MODEL_KEY).length, 1);
  assert.equal(result.find(model => model.key === H3_MODEL_KEY).configured, true);
  assert.equal(result.find(model => model.id === 2).name, '文本模型');
});
