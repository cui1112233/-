const test = require('node:test');
const assert = require('node:assert/strict');
const { batchFactoryRecoveryIndexPath } = require('../routes/batch-factory-v11');

test('automatic recovery scans the lightweight giant-only index', () => {
  assert.equal(batchFactoryRecoveryIndexPath(), '/api/batch-factory/v11/batches/recovery-index');
});
