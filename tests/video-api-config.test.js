const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_CONFIG, getVideoApiKey, normalizeVideoConfig, publicConfig } = require('../lib/shared');

test('video config keeps YD and H3 API keys separate and redacted', () => {
  const video = normalizeVideoConfig({ ydApiKey: 'yd-test-token', h3ApiKey: 'h3-test-token' });
  assert.equal(getVideoApiKey({ video }, 'yd'), 'yd-test-token');
  assert.equal(getVideoApiKey({ video }, 'h3'), 'h3-test-token');

  const safe = publicConfig({ ...DEFAULT_CONFIG, video });
  assert.equal(safe.video.ydHasApiKey, true);
  assert.equal(safe.video.h3HasApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(safe.video, 'ydApiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe.video, 'h3ApiKey'), false);
  assert.equal(JSON.stringify(safe).includes('yd-test-token'), false);
  assert.equal(JSON.stringify(safe).includes('h3-test-token'), false);
});

test('legacy video apiKey remains readable as both providers during migration', () => {
  const video = normalizeVideoConfig({ apiKey: 'legacy-video-token' });
  assert.equal(getVideoApiKey({ video }, 'yd'), 'legacy-video-token');
  assert.equal(getVideoApiKey({ video }, 'h3'), 'legacy-video-token');
});

test('API config exposes separate YD and H3 credential fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');
  assert.match(source, /label="YD2\.0 Mini API Key"/);
  assert.match(source, /label="MiniMax H3 API Key"/);
  assert.match(source, /name=\{\['video', 'ydApiKey'\]\}/);
  assert.match(source, /name=\{\['video', 'h3ApiKey'\]\}/);
});
