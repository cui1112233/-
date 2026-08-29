const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSparseOverride } = require('../routes/batch-factory-controls');

test('单书 override 只保存用户改过的字段', () => {
  const next = normalizeSparseOverride({
    quality: '单书画质',
    injectCharacterPrompt: false
  }, {});
  assert.deepEqual(next, {
    quality: '单书画质',
    injectCharacterPrompt: false
  });
});

test('恢复继承会删除 override key 而不是复制父级值', () => {
  const next = normalizeSparseOverride({
    restriction: '新的限制'
  }, {
    quality: '单书画质',
    restriction: '旧限制',
    negativeEnabled: false
  }, ['quality', 'negativeEnabled']);
  assert.deepEqual(next, {
    restriction: '新的限制'
  });
});

test('VIDEO override 支持显式 false、空文本和画幅覆盖', () => {
  const next = normalizeSparseOverride({
    aspectRatio: '16:9',
    quality: '',
    qualityEnabled: false,
    subtitlePolicy: 'allow'
  }, {});
  assert.deepEqual(next, {
    aspectRatio: '16:9',
    quality: '',
    qualityEnabled: false,
    subtitlePolicy: 'allow'
  });
});
