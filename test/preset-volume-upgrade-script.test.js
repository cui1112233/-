const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'scripts', 'verify-preset-volume-upgrade.sh');

test('Docker 升级演练必须复制正式卷到临时卷，且正式卷只读挂载', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /--source-volume/);
  assert.match(source, /--image/);
  assert.match(source, /qiantie-preset-upgrade-/);
  assert.match(source, /docker volume inspect/);
  assert.match(source, /docker volume create/);
  assert.match(source, /source_volume[^\n]*:\/from:ro|\$\{SOURCE_VOLUME\}:\/from:ro/);
  assert.match(source, /:\/to/);
  assert.doesNotMatch(source, /\$\{SOURCE_VOLUME\}:\/app\/data(?!:ro)/);
});

test('候选镜像只写临时卷并执行真实 preset migration/validation', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /:\/app\/data/);
  assert.match(source, /createPresetStore/);
  assert.match(source, /preset-store-schema\.json/);
  assert.match(source, /preset-store-backups/);
  assert.match(source, /preset-store-migration-audit\.json/);
  assert.match(source, /preset-store-quarantine\.json/);
});

test('临时卷只在显式 --cleanup 时删除，默认保留供 Codex 复核', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /--cleanup/);
  assert.match(source, /CLEANUP=false/);
  assert.match(source, /if \[ "\$CLEANUP" = true \]/);
  assert.match(source, /docker volume rm/);
  assert.doesNotMatch(source, /trap[^\n]*docker volume rm/);
});
