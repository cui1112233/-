const assert = require('node:assert/strict');
const test = require('node:test');
const { buildH3Request, h3ResultURL, h3TaskState, readH3TaskID } = require('../lib/h3-video-adapter');

test('H3 selects no-image workflow without inventing reference fields', () => {
  const request = buildH3Request({ prompt: '一只猫在云端漫步', duration: 5, resolution: '480p竖', referenceImages: [] });
  assert.equal(request.workflow, 'minimax_h3_lightx2v_no_pic');
  assert.deepEqual(request.body, { prompt: '一只猫在云端漫步', duration: 5, resolution: '480p竖' });
});

test('H3 maps reference images to ref_image_N fields', () => {
  const request = buildH3Request({ prompt: '人物转身', duration: 15, resolution: '768p竖', referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] });
  assert.equal(request.workflow, 'minimax_h3_lightx2v_v5_15s');
  assert.equal(request.body.ref_image_0, 'https://cdn.example/a.png');
  assert.equal(request.body.ref_image_1, 'https://cdn.example/b.png');
});

test('H3 reads nested task state and result URL', () => {
  assert.equal(readH3TaskID({ data: { task_id: 'task-1' } }), 'task-1');
  assert.equal(h3TaskState({ data: { status: 'SUCCESS' } }), 'SUCCESS');
  assert.equal(h3ResultURL({ data: { results: [{ url: 'https://cdn.example/task-1.mp4' }] } }), 'https://cdn.example/task-1.mp4');
});
