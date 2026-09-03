const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  UpdateManager,
  UpdateSecurityError,
  validateUpdateBaseUrl,
  parseUpdateManifest,
  compareVersions
} = require('../src/electron/update-manager');

test('updater rejects HTTP and accepts HTTPS update origins', () => {
  assert.throws(
    () => validateUpdateBaseUrl('http://115.190.156.223:3000/downloads/local-executor/updates'),
    error => error instanceof UpdateSecurityError && error.code === 'UPDATE_HTTPS_REQUIRED'
  );
  assert.equal(
    validateUpdateBaseUrl('https://updates.example.test/downloads/local-executor/updates/'),
    'https://updates.example.test/downloads/local-executor/updates'
  );
});

test('manifest validation is fail-closed and rejects traversal', () => {
  const valid = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'beta',
    version: '1.0.3',
    platform: 'win32',
    arch: 'x64',
    file: 'yizhan-local-executor-v88-1.0.3-win-x64.exe',
    sha256: 'a'.repeat(64),
    size: 12345,
    publishedAt: '2026-09-03T00:00:00.000Z'
  }, { channel: 'beta', platform: 'win32', arch: 'x64' });
  assert.equal(valid.version, '1.0.3');

  assert.throws(() => parseUpdateManifest({ ...valid, file: '../evil.exe' }, {
    channel: 'beta', platform: 'win32', arch: 'x64'
  }), /invalid update installer filename/i);
  assert.throws(() => parseUpdateManifest({ ...valid, channel: 'stable' }, {
    channel: 'beta', platform: 'win32', arch: 'x64'
  }), /channel/i);
  assert.throws(() => parseUpdateManifest({ ...valid, sha256: 'xyz' }, {
    channel: 'beta', platform: 'win32', arch: 'x64'
  }), /sha256/i);
});

test('semantic version comparison never treats an older version as newer', () => {
  assert.equal(compareVersions('1.0.3', '1.0.2') > 0, true);
  assert.equal(compareVersions('1.0.2', '1.0.2'), 0);
  assert.equal(compareVersions('1.0.1', '1.0.2') < 0, true);
  assert.equal(compareVersions('1.10.0', '1.9.9') > 0, true);
});

test('active VIDEO task defers verified installer launch', async () => {
  let spawned = 0;
  const manager = new UpdateManager({
    currentVersion: '1.0.2',
    platform: 'win32',
    arch: 'x64',
    updateBaseUrl: 'https://updates.example.test/downloads/local-executor/updates',
    userDataDir: 'C:/executor-data',
    currentTask: () => ({ id: 'job-1' }),
    spawnInstaller: async () => { spawned += 1; },
    quitApp: () => {},
    preferencesStore: fakePreferences('beta')
  });
  manager.markDownloadedForTest({
    version: '1.0.3',
    filePath: path.join('C:/executor-data', 'updates', '1.0.3.exe'),
    sha256: 'b'.repeat(64)
  });

  const result = await manager.installDownloaded();
  assert.equal(result.deferred, true);
  assert.equal(spawned, 0);
  assert.equal(manager.getState().status, 'install_deferred');
});

test('idle executor can launch a verified downloaded installer', async () => {
  const calls = [];
  const manager = new UpdateManager({
    currentVersion: '1.0.2',
    platform: 'win32',
    arch: 'x64',
    updateBaseUrl: 'https://updates.example.test/downloads/local-executor/updates',
    userDataDir: 'C:/executor-data',
    currentTask: () => null,
    spawnInstaller: async (filePath, args) => calls.push([filePath, args]),
    quitApp: () => calls.push(['quit']),
    preferencesStore: fakePreferences('beta')
  });
  manager.markDownloadedForTest({
    version: '1.0.3',
    filePath: 'C:/executor-data/updates/1.0.3.exe',
    sha256: 'c'.repeat(64)
  });

  const result = await manager.installDownloaded();
  assert.equal(result.installing, true);
  assert.deepEqual(calls[0], ['C:/executor-data/updates/1.0.3.exe', ['/S']]);
  assert.deepEqual(calls[1], ['quit']);
  assert.equal(manager.getState().status, 'installing');
});

test('channel selection persists and changes the feed path', async () => {
  const store = fakePreferences('beta');
  const manager = new UpdateManager({
    currentVersion: '1.0.2',
    platform: 'win32',
    arch: 'x64',
    updateBaseUrl: 'https://updates.example.test/downloads/local-executor/updates',
    userDataDir: '/tmp/executor',
    currentTask: () => null,
    preferencesStore: store,
    fetchJson: async url => {
      assert.equal(url, 'https://updates.example.test/downloads/local-executor/updates/stable/manifest.json');
      return {
        schemaVersion: 1,
        channel: 'stable',
        version: '1.0.2',
        platform: 'win32',
        arch: 'x64',
        file: 'yizhan-local-executor-v88-1.0.2-win-x64.exe',
        sha256: 'd'.repeat(64),
        size: 100,
        publishedAt: '2026-09-03T00:00:00.000Z'
      };
    }
  });
  await manager.setChannel('stable');
  assert.equal(store.load().channel, 'stable');
  const state = await manager.checkForUpdates();
  assert.equal(state.status, 'up_to_date');
});

function fakePreferences(initial) {
  let channel = initial;
  return {
    load() { return { channel }; },
    save(next) { channel = next.channel; return { channel }; }
  };
}
