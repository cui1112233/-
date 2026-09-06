const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(root, 'scripts', 'verify-v88-doubao-phase1.ps1');

test('Phase 1 Windows validation script mirrors the full verification and build gates', () => {
  assert.equal(fs.existsSync(scriptPath), true, 'scripts/verify-v88-doubao-phase1.ps1 must exist');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /Get-Command\s+node/i);
  assert.match(source, /Get-Command\s+npm/i);
  assert.match(source, /Get-Command\s+go/i);
  assert.match(source, /go\s+test\s+\.\/\.\.\./i);
  assert.match(source, /local-executor-updates\.test\.js/i);
  assert.match(source, /npm\s+test/i);
  assert.match(source, /npm\s+run\s+check/i);
  assert.match(source, /npm\s+run\s+build/i);
  assert.match(source, /npm\s+run\s+dist:win/i);
  assert.match(source, /Get-FileHash/i);
  assert.match(source, /SHA256/i);
  assert.match(source, /MAX_INSTALLER_MIB|MaxInstallerMiB/i);
  assert.match(source, /90/);
  assert.match(source, /local-validation-report\.json/i);
  assert.match(source, /minimumVersion/i);
  assert.match(source, /1\.0\.3/);
  assert.match(source, /channel/i);
  assert.match(source, /stable/i);
});

test('Phase 1 local report is tied to the package version instead of a second hard-coded release version', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /package\.json/i);
  assert.match(source, /ConvertFrom-Json/i);
  assert.doesNotMatch(source, /\$version\s*=\s*["']1\.0\.4["']/i);
  assert.match(source, /yizhan-local-executor-v88-\$version-win-x64\.exe/i);
});
