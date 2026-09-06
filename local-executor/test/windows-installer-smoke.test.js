const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('Windows installer smoke script verifies overwrite install and custom protocol registration', async () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'verify-windows-installer.ps1');
  const source = await readFile(scriptPath, 'utf8');

  assert.match(source, /param\(/);
  assert.match(source, /InstallerPath/);
  assert.match(source, /LocalApplicationData/);
  assert.match(source, /yizhan-doubao-local-executor/);
  assert.match(source, /一战晟铭豆包执行器\.exe/);
  assert.match(source, /yizhan-executor/);
  assert.match(source, /Software\\Classes\\yizhan-executor/);
  assert.match(source, /Start-Process[\s\S]*\/S/);
  assert.match(source, /firstInstallPath/);
  assert.match(source, /secondInstallPath/);
  assert.match(source, /duplicate install directories/i);
});

test('Windows build workflow runs the installer smoke verification before artifact upload', async () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'v88-local-executor-windows.yml');
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /Verify Windows installer overwrite and protocol/);
  assert.match(source, /verify-windows-installer\.ps1/);
});
