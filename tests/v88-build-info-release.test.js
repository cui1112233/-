const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let readReleaseInfo;
try {
  ({ readReleaseInfo } = require('../lib/release-info'));
} catch (_) {
  readReleaseInfo = null;
}

test('release info exposes exact environment SHA for git-direct deployments', () => {
  assert.ok(readReleaseInfo, 'lib/release-info.js must exist');
  const info = readReleaseInfo({
    env: {
      QIANTIE_RELEASE_SHA: 'abc123',
      QIANTIE_DEPLOY_MODE: 'git-direct',
      QIANTIE_DEPLOYED_AT: '2026-09-07T06:50:00Z'
    },
    rootDir: process.cwd()
  });
  assert.deepEqual(info, {
    branch: 'v88',
    git_sha: 'abc123',
    deployed_at: '2026-09-07T06:50:00Z',
    deploy_mode: 'git-direct'
  });
});

test('release info falls back to RELEASE-SHA file without inventing a commit', () => {
  assert.ok(readReleaseInfo, 'lib/release-info.js must exist');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-release-info-'));
  fs.writeFileSync(path.join(rootDir, 'RELEASE-SHA'), 'def456\n');
  const info = readReleaseInfo({ env: {}, rootDir });
  assert.equal(info.git_sha, 'def456');
  assert.equal(info.branch, 'v88');
  assert.equal(info.deploy_mode, 'git-direct');
});

test('server build-info route preserves legacy identity and overlays release identity', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.match(source, /app\.get\(['"]\/api\/build-info['"]/);
  assert.match(source, /app_version:\s*['"]v78\.3\.0\.3['"]/);
  assert.match(source, /build_id:\s*['"]v78\.3\.0\.3-remote-workbench-20260819-r1['"]/);
  assert.match(source, /\.\.\.readReleaseInfo\(\)/);
});
