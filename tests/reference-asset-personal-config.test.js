const test = require('node:test');
const assert = require('node:assert/strict');

const { referenceImageSettings } = require('../routes/novel-panel');

test('reference image generation reads the personal-center image config', () => {
  const settings = referenceImageSettings({
    username: 'alice',
    app: { locals: {
      novelPanelPremiumStore: { readImageSettingsRaw: () => ({ base_url: 'https://legacy.example', model: 'legacy', api_key: 'legacy-key' }) },
      novelPanelConfig: () => ({ image: { baseUrl: 'https://personal.example/v1', model: 'personal-image', apiKey: 'personal-key' } })
    } }
  });
  assert.equal(settings.base_url, 'https://personal.example/v1');
  assert.equal(settings.model, 'personal-image');
  assert.equal(settings.api_key, 'personal-key');
});
