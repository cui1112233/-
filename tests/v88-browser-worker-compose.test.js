const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const overlay = 'deploy/v88-public/docker-compose.browser-worker.yml';
const fixture = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  QIANTIE_GO_IMAGE: 'example/go:test-pin',
  QIANTIE_NODE_IMAGE: 'example/node:test-pin',
  QIANTIE_SHUIHUO_COMPAT_IMAGE: 'example/compat:test-pin',
  QIANTIE_BROWSER_WORKER_IMAGE: 'example/browser:test-pin',
  MYSQL_USER: 'fixture-user', MYSQL_PASSWORD: 'fixture-password', MYSQL_DATABASE: 'fixture-db',
  QIANTIE_RELEASE_SHA: 'fixture-release', QIANTIE_BRIDGE_SECRET: 'fixture-bridge',
  QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL: 'https://example.invalid',
  QIANTIE_REFERENCE_ASSET_SIGNING_SECRET: 'fixture-signing',
  QIANTIE_121_CREDENTIAL_SECRET: 'fixture-credential',
  HOST: 'operator-host', PORT: '9090', LANG: 'operator-language', LC_ALL: 'operator-locale',
  PLAYWRIGHT_BROWSERS_PATH: '/fixture/browsers',
  QIANTIE_121_WORKER_SECRET: 'fixture-worker',
};

function compose(extraEnv = {}) {
  return spawnSync('docker', ['compose', '--env-file', '/dev/null',
    '-f', 'deploy/v88-public/docker-compose.yml', '-f', overlay,
    'config', '--format', 'json'], { cwd: root, env: { ...fixture, ...extraEnv }, encoding: 'utf8' });
}

function workerConfig() {
  assert.ok(fs.existsSync(path.join(root, overlay)), 'tracked Browser Worker overlay is missing');
  const result = compose();
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Browser Worker keeps its image selection and internal-only Compose network', () => {
  const config = workerConfig();
  const worker = config.services['browser-worker'];
  assert.equal(worker.image, 'example/browser:test-pin');
  assert.equal(worker.restart, 'unless-stopped');
  assert.equal(worker.ports, undefined);
  assert.deepEqual(Object.keys(worker.networks), ['qiantie_internal']);
  assert.equal(config.networks.qiantie_internal.name, 'v88-public_qiantie_internal');
  assert.equal(config.networks.qiantie_internal.external, true);
});

test('Browser Worker preserves writable sessions and read-only legacy named storage', () => {
  const config = workerConfig();
  const mounts = config.services['browser-worker'].volumes;
  assert.equal(mounts.length, 2);
  assert.deepEqual(mounts.map(({ type, source, target, read_only }) =>
    ({ type, source, target, readOnly: Boolean(read_only) })), [
    { type: 'volume', source: 'browser_sessions', target: '/data/sessions', readOnly: false },
    { type: 'volume', source: 'novel-fetch-121-data', target: '/data/legacy-sessions', readOnly: true },
  ]);
  assert.equal(config.volumes.browser_sessions.name, 'v88-public_browser_sessions');
  assert.equal(config.volumes.browser_sessions.external, true);
  assert.equal(config.volumes['novel-fetch-121-data'].name, 'v88-public_novel-fetch-121-data');
  assert.equal(config.volumes['novel-fetch-121-data'].external, true);
});

test('Browser Worker overlay only requires its secret and preserves base runtime defaults', () => {
  const env = workerConfig().services['browser-worker'].environment;
  assert.deepEqual(Object.keys(env).sort(), [
    'HOST', 'PORT',
    'QIANTIE_121_HEADED_ENABLED', 'QIANTIE_121_LEGACY_SESSION_DIR',
    'QIANTIE_121_LOGIN_TIMEOUT_MS', 'QIANTIE_121_SESSION_DIR',
    'QIANTIE_121_VERIFY_TIMEOUT_MS', 'QIANTIE_121_WORKER_SECRET',
  ].sort());
  assert.equal(env.QIANTIE_121_WORKER_SECRET, fixture.QIANTIE_121_WORKER_SECRET);
  assert.equal(env.QIANTIE_121_HEADED_ENABLED, '1');
  assert.equal(env.QIANTIE_121_LEGACY_SESSION_DIR, '/data/legacy-sessions');
  assert.equal(env.QIANTIE_121_LOGIN_TIMEOUT_MS, '55000');
  assert.equal(env.QIANTIE_121_SESSION_DIR, '/data/sessions');
  assert.equal(env.QIANTIE_121_VERIFY_TIMEOUT_MS, '30000');
  assert.equal(env.HOST, '0.0.0.0', 'base listener default must not inherit operator HOST');
  assert.equal(env.PORT, '8787', 'base listener default must not inherit operator PORT');
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']) {
    assert.equal(env[name], undefined, `${name} remains image-owned`);
  }
  const absentSecret = compose({ QIANTIE_121_WORKER_SECRET: '' });
  assert.notEqual(absentSecret.status, 0, 'worker secret must fail closed');
  assert.match(absentSecret.stderr, /QIANTIE_121_WORKER_SECRET/);
});

test('Browser Worker health probe supplies the internal secret and fails on unhealthy responses', () => {
  const health = workerConfig().services['browser-worker'].healthcheck;
  assert.deepEqual(health.test.slice(0, 3), ['CMD', 'node', '-e']);
  assert.equal(health.interval, '5s');
  assert.equal(health.timeout, '3s');
  assert.equal(health.retries, 20);
  // Exercise the actual healthcheck expression with a controlled HTTP boundary.
  const vm = require('node:vm');
  for (const statusCode of [200, 401, 503]) {
    let request;
    let exitCode;
    vm.runInNewContext(health.test[3], {
      process: { env: { QIANTIE_121_WORKER_SECRET: 'fixture-health' }, exit: (code) => { exitCode = code; } },
      require: (name) => {
        assert.equal(name, 'http');
        return { get: (options, callback) => {
          request = options;
          callback({ statusCode });
          return { on: () => {} };
        } };
      },
    });
    assert.equal(request.host, '127.0.0.1');
    assert.equal(request.port, 8787);
    assert.equal(request.path, '/healthz');
    assert.equal(request.headers['x-qiantie-internal-secret'], 'fixture-health');
    assert.equal(exitCode, statusCode === 200 ? 0 : 1);
  }
});
