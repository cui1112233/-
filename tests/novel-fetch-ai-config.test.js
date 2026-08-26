const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAiSettings } = require('../lib/novel-fetch-workshop/ai');

test('改文配置兼容 camelCase 保存字段，重试不会误报等待 AI 配置', () => {
  const settings = resolveAiSettings({
    getAiConfig: () => ({
      ai: {},
      ai_assignments: { rewrite: 'preset_current_auto' },
      ai_presets: [{ id: 'preset_current_auto', baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'model' }]
    })
  }, 'rewrite');
  assert.equal(settings.baseUrl, 'https://example.test/v1');
  assert.equal(settings.apiKey, 'key');
  assert.equal(settings.model, 'model');
});
