const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('scripts/production-backup-baseline.sh', 'utf8');

test('backup script only permits baseline and backup operations', () => {
  assert.match(source, /usage: .*baseline\|backup/);
  assert.match(source, /legacy-test\|production/);
  assert.doesNotMatch(source, /docker compose .*down/);
  assert.doesNotMatch(source, /docker volume rm/);
  assert.doesNotMatch(source, /rm -rf/);
});

test('backup script records protected business tables and uses a consistent dump', () => {
  for (const table of ['users', 'model_definitions', 'shuihuo_projects', 'batch_factory_batches', 'batch_factory_items']) {
    assert.match(source, new RegExp(table));
  }
  assert.match(source, /mysqldump.*--single-transaction/);
  assert.match(source, /baseline\.json/);
});
