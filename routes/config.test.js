const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePetConfig } = require('./config');

test('config normalization stores only canonical pet values', () => {
  const existing = { id: 'pixiu', displayName: '旧名称', customField: 'preserve elsewhere' };
  assert.equal(normalizePetConfig('pixiu').id, 'pixiu');
  assert.equal(normalizePetConfig({ id: 'pixiu', displayName: '伪造' }).displayName, '貔貅');
  assert.equal(normalizePetConfig(undefined, existing).id, 'pixiu');
  assert.equal(normalizePetConfig({ id: 'unknown' }, existing).id, 'pixiu');
});
