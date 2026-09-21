const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const PLATFORM_CONTAINER = 'qiantie-v88-local-13188-platform-1';
const BACKEND_CONTAINER_FILTER = 'name=qiantie-v88-local-13188-batch-factory-v11-1';

function runningBackendContainer() {
  const name = execFileSync('docker', [
    'ps', '--filter', BACKEND_CONTAINER_FILTER, '--format', '{{.Names}}'
  ], { encoding: 'utf8' }).trim();
  assert.ok(name, 'local V12 batch-factory backend container is not running');
  return name.split(/\r?\n/, 1)[0];
}

test('local V12 platform routes novel-fetch workshop storage to its healthy batch-factory backend', () => {
  const environment = execFileSync('docker', [
    'inspect', PLATFORM_CONTAINER,
    '--format', '{{range .Config.Env}}{{println .}}{{end}}'
  ], { encoding: 'utf8' });

  assert.match(environment, /^QIANTIE_GO_BASE_URL=http:\/\/qiantie-v88-local-13188-batch-factory-v11-1:4000$/m);
});

test('local V12 batch-factory backend can resolve its workshop MySQL dependency', () => {
  const backendContainer = runningBackendContainer();
  assert.doesNotThrow(() => execFileSync('docker', [
    'exec', backendContainer, '/qiantie', 'healthcheck'
  ], { stdio: 'pipe' }));
});
