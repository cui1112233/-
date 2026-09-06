const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('Windows executor workflow follows phase branch and derives version from package.json', async () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'v88-local-executor-windows.yml');
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /'fix\/v88-doubao-executor-\*'/);
  assert.doesNotMatch(source, /EXECUTOR_VERSION:\s*1\.0\.3/);
  assert.match(source, /require\('\.\/package\.json'\)\.version/);
  assert.match(source, /build-report\.json/);
  assert.match(source, /sizeMiB/);
  assert.match(source, /steps\.metadata\.outputs\.version/);
});

test('Windows executor workflow fails the build when installer exceeds the Phase 1 size ceiling', async () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'v88-local-executor-windows.yml');
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /MAX_INSTALLER_MIB:\s*90/);
  assert.match(source, /installer is too large/i);
  assert.match(source, /sizeMiB/);
  assert.match(source, /MAX_INSTALLER_MIB/);
});
