const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = 'deploy/v88-direct/repair-121-worker-secret-host.sh';

test('121 live repair changes only Node worker auth secret and rolls back on failure', () => {
  assert.ok(fs.existsSync(path), 'repair-121-worker-secret-host.sh must exist');
  const source = fs.readFileSync(path, 'utf8');

  assert.match(source, /v88-stage\.env/);
  assert.match(source, /v88-public-browser-worker/);
  assert.match(source, /QIANTIE_121_WORKER_SECRET/);
  assert.match(source, /docker inspect[\s\S]*worker_id/);
  assert.match(source, /cp -a [^\n]*ENV_FILE[^\n]*backup/);
  assert.match(source, /grep -v[^\n]*QIANTIE_121_WORKER_SECRET/);
  assert.match(source, /systemctl restart qiantie-v88-node-stage\.service/);
  assert.match(source, /trap[^\n]*rollback[^\n]*ERR/);
  assert.match(source, /healthz/);
  assert.match(source, /api\/build-info/);
  assert.match(source, /before_sha/);
  assert.match(source, /after_sha/);
  assert.match(source, /before_sha[^\n]*after_sha|after_sha[^\n]*before_sha/);
  assert.doesNotMatch(source, /docker (rm|stop|compose|restart)/);
  assert.doesNotMatch(source, /QIANTIE_121_CREDENTIAL_SECRET=.*worker/);
  assert.doesNotMatch(source, /QIANTIE_121_STORAGE_STATE_SECRET=.*worker/);
});
