const test = require('node:test');
const assert = require('node:assert/strict');
const {
  H3_DEFAULT_WORKFLOW,
  H3_NO_IMAGE_WORKFLOW,
  buildH3Request,
  normalizeH3WorkflowId
} = require('../lib/h3-video-adapter');

const refs = count => Array.from({ length: count }, (_, index) => `https://example.com/ref-${index}.png`);

test('H3 defaults to the configured image-audio workflow when no workflow id is supplied', () => {
  assert.equal(normalizeH3WorkflowId(''), H3_DEFAULT_WORKFLOW);
  const request = buildH3Request({ prompt: 'test', duration: 5, resolution: '480p竖', referenceImages: refs(1) });
  assert.equal(request.workflow, H3_DEFAULT_WORKFLOW);
  assert.equal(request.body.ref_image_0, refs(1)[0]);
});

test('H3 no-image workflow clears reference images before submission', () => {
  const request = buildH3Request({
    workflowId: H3_NO_IMAGE_WORKFLOW,
    prompt: 'test',
    duration: 5,
    resolution: '480p竖',
    referenceImages: refs(2)
  });
  assert.equal(request.workflow, H3_NO_IMAGE_WORKFLOW);
  assert.equal(request.body.ref_image_0, undefined);
  assert.equal(request.body.ref_image_1, undefined);
});

test('H3 workflow ids accept AutoDL slugs and reject path injection', () => {
  assert.equal(normalizeH3WorkflowId('minimax_h3_b99_001'), 'minimax_h3_b99_001');
  assert.throws(() => normalizeH3WorkflowId('../secret'), /工作流 ID 不合法/);
  assert.throws(() => normalizeH3WorkflowId('workflow name'), /工作流 ID 不合法/);
});
