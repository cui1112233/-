const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveV11GoBaseUrl } = require('../routes/batch-factory-v11');

test('V11 uses its dedicated upstream when configured', () => {
  assert.equal(
    resolveV11GoBaseUrl({
      QIANTIE_BATCH_FACTORY_V11_BASE_URL: 'http://batch-factory-v11:4000',
      QIANTIE_GO_BASE_URL: 'http://backend:4000'
    }),
    'http://batch-factory-v11:4000'
  );
});

test('V11 keeps the legacy Go upstream as its compatibility fallback', () => {
  assert.equal(resolveV11GoBaseUrl({ QIANTIE_GO_BASE_URL: 'http://backend:4000' }), 'http://backend:4000');
});
