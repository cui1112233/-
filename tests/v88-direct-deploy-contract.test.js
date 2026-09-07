const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const dockerReleasePath = '.github/workflows/v88-linux-amd64-image-release.yml';
const directDeployPath = '.github/workflows/v88-ecs-direct-deploy.yml';
const dockerRelease = fs.readFileSync(dockerReleasePath, 'utf8');
const directDeploy = fs.existsSync(directDeployPath) ? fs.readFileSync(directDeployPath, 'utf8') : '';

function workflowOnBlock(source) {
  const start = source.indexOf('\non:\n');
  assert.ok(start >= 0, 'workflow must contain on: block');
  const after = source.slice(start + 1);
  const nextTopLevel = after.slice(4).search(/^\S/m);
  return nextTopLevel >= 0 ? after.slice(0, 4 + nextTopLevel) : after;
}

function run(file, args = [], cwd = process.cwd()) {
  return spawnSync(file, args, { cwd, encoding: 'utf8' });
}

test('routine Docker release no longer listens to v88 push', () => {
  const onBlock = workflowOnBlock(dockerRelease);
  assert.doesNotMatch(onBlock, /push:\s*[\s\S]*branches:\s*[\s\S]*- v88/);
  assert.match(onBlock, /workflow_dispatch:/);
});

test('direct deploy exists and deploys exact GITHUB_SHA', () => {
  assert.ok(directDeploy, 'direct deploy workflow must exist');
  assert.match(directDeploy, /branches:\s*\n\s*- v88/);
  assert.match(directDeploy, /GITHUB_SHA/);
  assert.match(directDeploy, /deploy\/v88-direct\/deploy\.sh/);
});

test('direct deploy does not build or publish Docker images', () => {
  assert.ok(directDeploy, 'direct deploy workflow must exist');
  assert.doesNotMatch(directDeploy, /docker build/);
  assert.doesNotMatch(directDeploy, /docker push/);
  assert.doesNotMatch(directDeploy, /docker pull/);
});

test('change classifier isolates frontend-only changes', () => {
  const script = path.resolve('deploy/v88-direct/classify-changes.sh');
  assert.ok(fs.existsSync(script), 'classify-changes.sh must exist');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-direct-'));
  execFileSync('git', ['init'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });
  fs.mkdirSync(path.join(tmp, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'frontend', 'a.txt'), 'a');
  execFileSync('git', ['add', '.'], { cwd: tmp });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: tmp, stdio: 'ignore' });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(tmp, 'frontend', 'a.txt'), 'b');
  execFileSync('git', ['commit', '-am', 'frontend'], { cwd: tmp, stdio: 'ignore' });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
  const out = execFileSync('bash', [script, base, head], { cwd: tmp, encoding: 'utf8' });
  assert.match(out, /FRONTEND_CHANGED=1/);
  assert.match(out, /NODE_CHANGED=0/);
  assert.match(out, /GO_CHANGED=0/);
  assert.match(out, /WORKER_CHANGED=0/);
  assert.match(out, /MIGRATIONS_CHANGED=0/);
});

test('release preparation refuses current and writes exact SHA', () => {
  const script = path.resolve('deploy/v88-direct/prepare-release.sh');
  assert.ok(fs.existsSync(script), 'prepare-release.sh must exist');
  const bad = run('bash', [script, '/opt/qiantie/v88/current', 'abc123']);
  assert.notEqual(bad.status, 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-release-'));
  const release = path.join(tmp, 'abc123');
  const good = run('bash', [script, release, 'abc123']);
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.equal(fs.readFileSync(path.join(release, 'RELEASE-SHA'), 'utf8').trim(), 'abc123');
});

test('systemd units use current symlink, shared env and no Docker DNS', () => {
  const units = [
    'deploy/v88-direct/systemd/qiantie-v88-node.service',
    'deploy/v88-direct/systemd/qiantie-v88-go.service',
    'deploy/v88-direct/systemd/qiantie-v88-browser-worker.service'
  ].map(file => fs.readFileSync(file, 'utf8'));
  for (const unit of units) {
    assert.match(unit, /\/opt\/qiantie\/v88\/current/);
    assert.match(unit, /EnvironmentFile=\/opt\/qiantie\/v88\/shared\/env\/v88\.env/);
    assert.match(unit, /Restart=on-failure/);
    assert.doesNotMatch(unit, /novel-fetch-121-worker/);
  }
  assert.match(units[2], /browser-worker-sessions/);
});

test('bootstrap never deletes shared data or Docker volumes', () => {
  const source = fs.readFileSync('deploy/v88-direct/bootstrap-host.sh', 'utf8');
  assert.doesNotMatch(source, /docker\s+volume\s+rm/);
  assert.doesNotMatch(source, /rm\s+-rf\s+[^\n]*\/opt\/qiantie\/v88\/shared/);
  assert.match(source, /systemctl daemon-reload/);
});

test('deploy transaction builds before switching and contains rollback', () => {
  const source = fs.readFileSync('deploy/v88-direct/deploy.sh', 'utf8');
  const buildIndex = source.indexOf('BUILD_PRECHECK_COMPLETE=1');
  const switchIndex = source.indexOf('ln -sfn "$release_dir" "$CURRENT_LINK"');
  assert.ok(buildIndex >= 0 && switchIndex > buildIndex, 'release switch must happen after build/preflight');
  assert.match(source, /previous_target=/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /ln -sfn "\$previous_target" "\$CURRENT_LINK"/);
  assert.doesNotMatch(source, /rm\s+-rf\s+[^\n]*shared/);
  assert.match(source, /if \[ "\$GO_CHANGED" = "1" \]/);
  assert.match(source, /if \[ "\$WORKER_CHANGED" = "1" \]/);
  assert.match(source, /if \[ "\$MIGRATIONS_CHANGED" = "1" \]/);
});

test('all direct-deploy shell scripts pass bash syntax check', () => {
  for (const file of fs.readdirSync('deploy/v88-direct').filter(name => name.endsWith('.sh'))) {
    const result = run('bash', ['-n', path.join('deploy/v88-direct', file)]);
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});
