const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const scriptPath = 'scripts/deploy-production.sh';

test('production publisher exists and exposes guarded lifecycle commands', () => {
  assert.ok(fs.existsSync(scriptPath), 'scripts/deploy-production.sh must exist');
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /preflight\|publish\|verify\|rollback/);
  assert.match(source, /production-backup-baseline\.sh" backup production/);
  assert.match(source, /production-backup-baseline\.sh" baseline production/);
});

test('production publisher preserves data volumes and saves application rollback images', () => {
  assert.ok(fs.existsSync(scriptPath), 'scripts/deploy-production.sh must exist');
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /docker compose .*down/);
  assert.doesNotMatch(source, /docker volume rm/);
  assert.doesNotMatch(source, /down -v/);
  assert.match(source, /qiantie-platform:production-rollback-/);
  assert.match(source, /qiantie-backend:production-rollback-/);
  assert.match(source, /up --build -d --no-deps --force-recreate backend platform/);
  assert.match(source, /compose ps -q backend/);
  assert.match(source, /compose ps -q platform/);
});
