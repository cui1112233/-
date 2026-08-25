const test = require('node:test');
const assert = require('node:assert/strict');

const { quotaState } = require('../lib/team-governance-store');

test('zero monthly quota is immediately exhausted before the first call', () => {
  const quota = quotaState(0, 0);
  assert.equal(quota.percent, 100);
  assert.equal(quota.level, 'exhausted');
  assert.equal(quota.threshold, 100);
  assert.equal(quota.remaining, 0);
});
