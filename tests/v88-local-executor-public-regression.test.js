const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('ScriptPage accepts the public local-executor response shape', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /Array\.isArray\(result\?\.executors\)/);
  assert.match(source, /result\.executors/);
});

test('V88 release preserves the base compose environment and verifies Node to Go bridge auth', () => {
  const workflow = read('.github/workflows/v88-linux-amd64-image-release.yml');
  assert.doesNotMatch(workflow, /docker compose --env-file \"\$compose_dir\/novel-fetch-121\.env\"/);
  assert.match(workflow, /set -a[\s\S]*\. \"\$compose_dir\/novel-fetch-121\.env\"[\s\S]*set \+a/);
  assert.match(workflow, /node_bridge_secret/);
  assert.match(workflow, /go_bridge_secret/);
  assert.match(workflow, /QIANTIE_BRIDGE_SECRET mismatch between v88-node and go-api/);
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
  assert.ok(route.includes(installer));
  assert.match(overlay, /\/opt\/qiantie\/v88\/data\/downloads:\/app\/data\/downloads:ro/);
  assert.match(windowsWorkflow, /Publish Windows installer to V88 ECS/);
  assert.match(windowsWorkflow, /\/opt\/qiantie\/v88\/data\/downloads/);
});
