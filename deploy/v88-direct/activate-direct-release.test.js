const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const here = __dirname;
const script = path.join(here, 'activate-direct-release.sh');

test('direct activation waits for the Go API health check before recreating Node and Nginx', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-direct-release-'));
  const direct = path.join(root, 'direct');
  const deploy = path.join(root, 'deploy');
  const release = path.join(direct, 'releases', 'abcdef0');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'docker.log');
  fs.mkdirSync(path.join(release, 'go'), { recursive: true });
  fs.mkdirSync(path.join(release, 'node'), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(release, 'go', 'qiantie'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(release, 'node', 'server.js'), '');
  fs.mkdirSync(deploy);
  fs.writeFileSync(path.join(deploy, 'docker-compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(direct, 'docker-compose.direct.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(deploy, '.env'), 'DIRECT_RELEASE_SHA=oldsha\n');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
echo "$*" >> "$QIANTIE_TEST_DOCKER_LOG"
case "$*" in
  *"ps -q go-api"*) echo go-api-test ;;
  *"inspect --format"*) echo healthy ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho \'{"git_sha":"abcdef0"}\'\n', { mode: 0o755 });

  try {
    execFileSync('bash', [script, 'abcdef0'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DIRECT_ROOT: direct,
        DEPLOY_DIR: deploy,
        QIANTIE_TEST_DOCKER_LOG: log
      },
      stdio: 'pipe'
    });
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /up -d --no-deps --force-recreate --pull never go-api[\s\S]*inspect --format[\s\S]*up -d --no-deps --force-recreate --pull never v88-node[\s\S]*restart nginx/);
    assert.doesNotMatch(calls, /go-api v88-node/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
