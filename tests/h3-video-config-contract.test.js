const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CONFIG,
  getVideoApiKey,
  normalizeVideoConfig,
  publicConfig
} = require('../lib/shared');
const { accountAIConfigPayload } = require('../routes/shuihuo-production');

test('normalizes legacy video.apiKey to YD without copying it to H3', () => {
  const config = normalizeVideoConfig({ apiKey: 'legacy-key' }, DEFAULT_CONFIG.video);
  assert.equal(config.ydApiKey, 'legacy-key');
  assert.equal(config.h3ApiKey, '');
  assert.equal(getVideoApiKey({ video: config }, 'h3'), '');
});

test('public video config exposes independent configured flags only', () => {
  const safe = publicConfig({
    ...DEFAULT_CONFIG,
    apiKey: 'text-secret',
    video: { ydApiKey: 'yd-secret', h3ApiKey: 'h3-secret' }
  });
  assert.equal(safe.video.ydHasApiKey, true);
  assert.equal(safe.video.h3HasApiKey, true);
  assert.equal(JSON.stringify(safe).includes('h3-secret'), false);
  assert.equal(JSON.stringify(safe).includes('yd-secret'), false);
});

test('legacy Shuihuo bridge sync keeps the old YD video schema isolated from H3', () => {
  const payload = accountAIConfigPayload({
    video: { ydApiKey: 'yd-secret', h3ApiKey: 'h3-secret' }
  });
  assert.deepEqual(payload.video, { provider: 'yd_video', apiKey: 'yd-secret' });
  assert.equal(JSON.stringify(payload).includes('h3-secret'), false);
});
