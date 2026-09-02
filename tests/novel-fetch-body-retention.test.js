const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_WORKSHOP_CONFIG } = require('../lib/novel-fetch-workshop/config');
const { DEFAULT_CONFIG } = require('../lib/novel-fetch-workshop/mysql-store');

test('novel fetch body retention defaults to enabled seven days in both config paths', () => {
  assert.deepEqual(DEFAULT_WORKSHOP_CONFIG.storage, { cleanup_enabled: true, retention_days: 7 });
  assert.deepEqual(DEFAULT_CONFIG.storage, { cleanup_enabled: true, retention_days: 7 });
});
