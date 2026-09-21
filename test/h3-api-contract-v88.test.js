const test = require('node:test');
const assert = require('node:assert/strict');
const { buildH3Request } = require('../lib/h3-video-adapter');

const refs = count => Array.from({ length: count }, (_, index) => `https://example.com/ref-${index}.png`);

test('H3 reference workflow maps at most nine images to ref_image_0 through ref_image_8', () => {
  const request = buildH3Request({
    prompt: 'test',
    duration: 5,
    resolution: '768p竖',
    referenceImages: refs(9)
  });
  assert.equal(request.body.ref_image_0, refs(9)[0]);
  assert.equal(request.body.ref_image_8, refs(9)[8]);
  assert.equal(request.body.ref_image_9, undefined);
  assert.throws(() => buildH3Request({ prompt: 'test', referenceImages: refs(10) }), /最多支持 9 张参考图片/);
});

test('H3 contract accepts the documented square resolution values', () => {
  for (const resolution of ['480p(1:1)', '768p(1:1)']) {
    const request = buildH3Request({ prompt: 'test', duration: 5, resolution, referenceImages: refs(1) });
    assert.equal(request.body.resolution, resolution);
  }
});
