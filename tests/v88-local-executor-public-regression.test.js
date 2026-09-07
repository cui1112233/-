const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// RED first: these contracts describe the public behavior that regressed after release.
test('ScriptPage accepts the public local-executor response shape', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /Array\.isArray\(result\?\.executors\)/);
  assert.match(source, /result\.executors/);
});

test('production Node can recover a missing bridge secret from the mounted base env without overwriting explicit env', () => {
  const { hydrateMissingEnvFromFile } = require('../lib/runtime-env');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-runtime-env-'));
  const file = path.join(dir, 'base.env');
  fs.writeFileSync(file, 'QIANTIE_BRIDGE_SECRET=from-base-env\nOTHER_KEY=ignored\n');
  const env = { QIANTIE_BRIDGE_SECRET: '' };
  hydrateMissingEnvFromFile(file, ['QIANTIE_BRIDGE_SECRET'], env);
  assert.equal(env.QIANTIE_BRIDGE_SECRET, 'from-base-env');
  const explicit = { QIANTIE_BRIDGE_SECRET: 'already-set' };
  hydrateMissingEnvFromFile(file, ['QIANTIE_BRIDGE_SECRET'], explicit);
  assert.equal(explicit.QIANTIE_BRIDGE_SECRET, 'already-set');

  const server = read('server.js');
  const overlay = read('deploy/v88-public/docker-compose.browser-worker.yml');
  assert.match(server, /hydrateMissingEnvFromFile/);
  assert.match(server, /QIANTIE_BRIDGE_SECRET/);
  assert.match(overlay, /\/opt\/qiantie\/v88\/deploy\/v88-public\/\.env:\/run\/qiantie\/base\.env:ro/);
});

test('current Windows executor is exposed through the public downloads mount', () => {
  const pkg = JSON.parse(read('local-executor/package.json'));
  assert.equal(pkg.version, '1.0.3');
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  const route = read('routes/local-executor-downloads.js');
  const overlay = read('deploy/v88-public/docker-compose.browser-worker.yml');
  const windowsWorkflow = read('.github/workflows/v88-local-executor-windows.yml');
  const installer = `yizhan-local-executor-v88-${pkg.version}-win-x64.exe`;
  assert.ok(settings.includes(`/downloads/local-executor/${installer}`));
  assert.match(route, new RegExp(`const RELEASE_VERSION = ['\"]${pkg.version.replace(/\./g, '\\.') }['\"]`));
  assert.match(route, /WINDOWS_INSTALLER\s*=\s*`yizhan-local-executor-v88-\$\{RELEASE_VERSION\}-win-x64\.exe`/);
  assert.match(overlay, /\/opt\/qiantie\/v88\/data\/downloads:\/app\/data\/downloads:ro/);
  assert.match(windowsWorkflow, /Publish Windows installer to V88 ECS/);
  assert.match(windowsWorkflow, /\/opt\/qiantie\/v88\/data\/downloads/);
});
