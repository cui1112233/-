const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRelease, renderRollback } = require('../lib/batch-factory-v11/release-contract');

test('release rejects latest tags', () => {
  assert.throws(() => validateRelease({ release:'x', composeFile:'docker-compose.yml', backupDir:'artifacts', previousWeb:'qiantie-web:sha-a', previousGo:'qiantie-go:sha-a', targetWeb:'qiantie-web:latest', targetGo:'qiantie-go:sha-b' }), /immutable/);
});

test('rollback consumes recorded prior images', () => {
  const text = renderRollback({ previousWeb:'qiantie-web:sha-previous', previousGo:'qiantie-backend:sha-previous', composeFile:'docker-compose.yml', schemaChanged:true, backupId:'b1' });
  assert.match(text, /qiantie-web:sha-previous/);
  assert.match(text, /qiantie-backend:sha-previous/);
});
