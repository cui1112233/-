const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings } = require('../lib/batch-factory/store');

test('批次设置保留发布统一设置并限制数值范围', () => {
  const settings = normalizeSettings({
    maxVideoDuration: 15,
    publishSettings: { uploadType: 'merged', scrollCount: 3, generateCount: 10, mergeSpeed: '1.5x' }
  });
  assert.equal(settings.maxVideoDuration, 15);
  assert.deepEqual(settings.publishSettings, { uploadType: 'merged', durationMode: 'speed', mergeSpeed: '1.5x', scrollCount: 3, generateCount: 10, reuse: true, flip: true, unpackSpeed: '1.7', pitch: '0', aiHeader: 'final', uploadTxt: true });
  assert.equal(normalizeSettings({ maxVideoDuration: 999 }).maxVideoDuration, 10);
});
