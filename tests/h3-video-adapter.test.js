const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildH3Request,
  h3ResultURL,
  h3TaskState,
  readH3TaskID
} = require('../lib/h3-video-adapter');

test('H3 no-image request uses the text-to-video workflow and does not invent image fields', () => {
  const request = buildH3Request({ prompt: '一只猫在云端漫步', duration: 5, resolution: '480p竖', referenceImages: [] });
  assert.equal(request.path, '/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic');
  assert.deepEqual(request.body, { prompt: '一只猫在云端漫步', duration: 5, resolution: '480p竖' });
});

test('H3 reference request uses ref_image_N fields only when usable images exist', () => {
  const request = buildH3Request({
    prompt: '人物转身并抬头',
    duration: 15,
    resolution: '768p竖',
    referenceImages: ['https://cdn.example.test/a.png', '', 'https://cdn.example.test/b.png']
  });
  assert.equal(request.path, '/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s');
  assert.deepEqual(request.body, {
    prompt: '人物转身并抬头',
    duration: 15,
    resolution: '768p竖',
    ref_image_0: 'https://cdn.example.test/a.png',
    ref_image_1: 'https://cdn.example.test/b.png'
  });
});

test('H3 parses AutoDL task id, status and result URL from nested data', () => {
  assert.equal(readH3TaskID({ code: 'Success', data: { task_id: 'task-123' } }), 'task-123');
  assert.equal(h3TaskState({ data: { status: 'QUEUED' } }), 'QUEUED');
  assert.equal(h3TaskState({ data: { status: 'RUNNING' } }), 'RUNNING');
  assert.equal(h3TaskState({ data: { status: 'SUCCESS' } }), 'SUCCESS');
  assert.equal(h3TaskState({ data: { status: 'FAILED' } }), 'FAILED');
  assert.equal(h3ResultURL({ data: { results: [{ type: 'video', url: 'https://cdn.example.test/result.mp4' }] } }), 'https://cdn.example.test/result.mp4');
  assert.equal(h3ResultURL({ data: { results: [] } }), '');
});
