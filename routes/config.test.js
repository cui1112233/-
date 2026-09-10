const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePetConfig } = require('./config');
const { normalizeModelDirectory, publicModelDirectory } = require('../lib/shared');

test('config normalization stores only canonical pet values', () => {
  const existing = { id: 'pixiu', displayName: '旧名称', customField: 'preserve elsewhere' };
  assert.equal(normalizePetConfig('pixiu').id, 'pixiu');
  assert.equal(normalizePetConfig({ id: 'pixiu', displayName: '伪造' }).displayName, '貔貅');
  assert.equal(normalizePetConfig(undefined, existing).id, 'pixiu');
  assert.equal(normalizePetConfig({ id: 'unknown' }, existing).id, 'pixiu');
});

test('model directory supports multiple capability-scoped entries and excludes secrets from public data', () => {
  const models = normalizeModelDirectory([
    { id: 'gpt-54', kind: 'text', name: 'GPT-5.4', provider: 'custom', endpoint: 'https://text.example/v1', model: 'gpt-5.4', apiKey: 'fixture-text' },
    { id: 'h3', kind: 'video', name: 'MiniMax H3', provider: 'AutoDL', endpoint: 'https://video.example', model: 'minimax_h3', apiKey: 'fixture-video' },
    { id: 'image-a', kind: 'image', name: '图片模型 A', provider: 'custom', endpoint: 'https://image.example/v1', model: 'image-a', apiKey: 'fixture-image' }
  ]);
  assert.deepEqual(models.map(model => model.kind), ['text', 'video', 'image']);
  assert.equal(models.filter(model => model.kind === 'text').length, 1);
  const safe = publicModelDirectory(models);
  assert.equal(safe[0].hasApiKey, true);
  assert.equal(Object.hasOwn(safe[0], 'apiKey'), false);
});

test('an explicit empty model directory stays empty instead of restoring legacy entries', () => {
  assert.deepEqual(normalizeModelDirectory([], { apiKey: 'legacy', model: 'legacy-model' }), []);
});
