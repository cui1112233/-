const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { normalizeVideoConfig, publicConfig } = require('../lib/shared');

test('video config defaults to the H3 model and keeps the model in safe public config', () => {
  const normalized = normalizeVideoConfig({ apiKey: 'secret-key' });
  assert.equal(normalized.modelKey, 'minimax-h3-video');
  const safe = publicConfig({ video: normalized });
  assert.equal(safe.video.modelKey, 'minimax-h3-video');
  assert.equal(safe.video.hasApiKey, true);
  assert.equal(safe.video.apiKey, undefined);
});

test('video config rejects unsupported model keys by falling back to H3', () => {
  assert.equal(normalizeVideoConfig({ modelKey: 'unknown-model' }).modelKey, 'minimax-h3-video');
});

test('API config page exposes H3 model selection and persists it', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');
  assert.match(source, /modelKey/);
  assert.match(source, /minimax-h3-video/);
  assert.match(source, /MiniMax H3 多图生视频/);
});
