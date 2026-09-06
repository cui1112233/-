const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Electron main process enforces one instance and registers the executor protocol', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /requestSingleInstanceLock\s*\(/);
  assert.match(source, /second-instance/);
  assert.match(source, /setAsDefaultProtocolClient\s*\(/);
  assert.match(source, /findExecutorProtocolAction/);
  assert.match(source, /focusExecutorWindow/);
});

test('update protocol focuses the executor and invokes the built-in verified updater', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /request\.action\s*===\s*['"]update['"]/);
  assert.match(source, /checkForUpdates\(\{\s*autoDownload:\s*true\s*\}\)/);
  assert.doesNotMatch(source, /powershell|cmd\.exe|curl\s/i);
});

test('electron-builder installer registers yizhan-executor as an application protocol', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const protocols = Array.isArray(pkg.build?.protocols) ? pkg.build.protocols : [];
  assert.ok(protocols.some(item => Array.isArray(item.schemes) && item.schemes.includes('yizhan-executor')));
});
