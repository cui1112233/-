import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  compareSemver,
  executorVersionStatus,
  fetchExecutorReleaseManifest
} from './executorRelease.js';

test('compares strict x.y.z executor versions numerically', () => {
  assert.equal(compareSemver('1.0.3', '1.0.4'), -1);
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0.3', '1.0.3'), 0);
  assert.equal(compareSemver('v1.0.3', '1.0.3'), null);
  assert.equal(compareSemver('1.0', '1.0.0'), null);
});

test('derives update available and required from latest/minimum versions', () => {
  assert.deepEqual(
    executorVersionStatus('1.0.2', { latestVersion: '1.0.4', minimumVersion: '1.0.3' }),
    { currentVersion: '1.0.2', latestVersion: '1.0.4', minimumVersion: '1.0.3', updateAvailable: true, updateRequired: true, versionKnown: true }
  );
  assert.deepEqual(
    executorVersionStatus('1.0.4', { latestVersion: '1.0.4', minimumVersion: '1.0.3' }),
    { currentVersion: '1.0.4', latestVersion: '1.0.4', minimumVersion: '1.0.3', updateAvailable: false, updateRequired: false, versionKnown: true }
  );
});

test('keeps unknown executor versions explicit instead of guessing', () => {
  assert.deepEqual(
    executorVersionStatus('', { latestVersion: '1.0.4', minimumVersion: '1.0.3' }),
    { currentVersion: '', latestVersion: '1.0.4', minimumVersion: '1.0.3', updateAvailable: false, updateRequired: false, versionKnown: false }
  );
});

test('loads public executor manifest as the download/version source', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          version: '1.0.4',
          latestVersion: '1.0.4',
          minimumVersion: '1.0.3',
          downloads: {
            windows: '/downloads/local-executor/updates/stable/yizhan-local-executor-v88-1.0.4-win-x64.exe',
            mac: '/downloads/local-executor/yizhan-local-executor-legacy-mac-arm64.dmg'
          }
        };
      }
    };
  };

  const manifest = await fetchExecutorReleaseManifest(fakeFetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/downloads/local-executor/manifest.json');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(manifest.latestVersion, '1.0.4');
  assert.match(manifest.downloads.windows, /1\.0\.4-win-x64\.exe$/);
  assert.ok(manifest.downloads.mac);
});

test('rejects malformed release manifests instead of inventing a latest version', async () => {
  const fakeFetch = async () => ({ ok: true, async json() { return { version: 'latest', downloads: {} }; } });
  await assert.rejects(() => fetchExecutorReleaseManifest(fakeFetch), /执行器发布信息无效/);
});

test('SettingsPage consumes the dynamic executor release source and has no legacy version literal', async () => {
  const settingsUrl = new URL('../../user/pages/SettingsPage.jsx', import.meta.url);
  const source = await readFile(settingsUrl, 'utf8');
  assert.doesNotMatch(source, /0\.1\.14/);
  assert.match(source, /fetchExecutorReleaseManifest/);
  assert.match(source, /executorVersionStatus/);
});
