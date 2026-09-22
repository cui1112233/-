const test = require('node:test');
const assert = require('node:assert/strict');

const { createTextVerificationCache } = require('./model-catalog-verification');

const model = {
  baseUrl: 'https://api.example.test/v1',
  modelId: 'example-text',
  credential: 'test-key'
};

test('a text-model verification only authorizes the exact tested runtime configuration', () => {
  const verification = createTextVerificationCache({ now: () => 1000 });
  verification.approve('manager-a', model);

  assert.doesNotThrow(() => verification.assertApproved('manager-a', model));
  assert.throws(
    () => verification.assertApproved('manager-a', { ...model, modelId: 'another-text' }),
    /请先测试文本模型连接成功/
  );
});

test('a text-model verification expires instead of authorizing a later save forever', () => {
  let now = 1000;
  const verification = createTextVerificationCache({ now: () => now, ttlMs: 100 });
  verification.approve('manager-a', model);
  now += 101;

  assert.throws(() => verification.assertApproved('manager-a', model), /请先测试文本模型连接成功/);
});
