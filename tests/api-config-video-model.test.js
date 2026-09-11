const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { H3_MODEL_KEY, getDefaultVideoModels } = require('../lib/video-model-catalog');

test('video model catalog exposes the H3 capability without exposing credentials', () => {
  const h3 = getDefaultVideoModels({ h3Configured: true }).find(model => model.key === H3_MODEL_KEY);
  assert.equal(h3.name, 'MiniMax H3 多图生视频');
  assert.equal(h3.configured, true);
  assert.equal(h3.maxVideoDuration, 15);
  assert.equal(h3.supportsReferenceImages, true);
  assert.equal(Object.hasOwn(h3, 'apiKey'), false);
});

test('video model catalog keeps H3 available even when its server credential is not configured', () => {
  const h3 = getDefaultVideoModels({ h3Configured: false }).find(model => model.key === H3_MODEL_KEY);
  assert.equal(h3.configured, false);
});

test('API config page manages catalog presets instead of a legacy single model key', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');
  assert.match(source, /PLATFORM_PRESETS/);
  assert.match(source, /MiniMax H3 多图生视频/);
  assert.match(source, /createManagedModel/);
});
