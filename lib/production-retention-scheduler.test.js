const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductionRetentionScheduler } = require('./production-retention-scheduler');

test('retention scheduler runs once per invocation for each user and keeps user settings isolated', async () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-users-'));
  fs.mkdirSync(path.join(usersDir, 'alice'));
  fs.mkdirSync(path.join(usersDir, 'bob'));
  const configs = { alice: { storageRoot: path.join(usersDir, 'alice-files'), productionRetentionDays: 14 }, bob: { storageRoot: '', productionRetentionDays: 30 } };
  const seen = [];
  const scheduler = createProductionRetentionScheduler({
    usersDir,
    configReader: username => configs[username],
    cleanupLocal: (plan, options) => { seen.push({ days: plan.retentionDays, root: plan.root, options }); return { deleted: 1, skipped: 2, failed: 0 }; },
    logger: { info() {}, warn() {}, error() {} }
  });
  const result = await scheduler.runOnce({ dryRun: true });
  assert.equal(result.users, 2);
  assert.equal(result.deleted, 2);
  assert.deepEqual(seen.map(item => item.days), [14, 30]);
  assert.equal(seen[0].options.dryRun, true);
});
