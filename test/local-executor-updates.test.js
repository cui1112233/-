const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createLocalExecutorDownloadsRouter } = require('../routes/local-executor-downloads');

test('V88 update feed serves only allow-listed beta/stable manifests and installers', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yizhan-update-feed-'));
  const updates = path.join(root, 'local-executor-updates');
  const beta = path.join(updates, 'beta');
  fs.mkdirSync(beta, { recursive: true });
  const file = 'yizhan-local-executor-v88-1.0.3-win-x64.exe';
  fs.writeFileSync(path.join(beta, file), 'fake-installer');
  fs.writeFileSync(path.join(beta, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    channel: 'beta',
    version: '1.0.3',
    platform: 'win32',
    arch: 'x64',
    file,
    sha256: 'a'.repeat(64),
    size: 14,
    publishedAt: '2026-09-03T00:00:00.000Z'
  }));

  const app = express();
  app.use('/downloads/local-executor', createLocalExecutorDownloadsRouter({ downloadsDir: root }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/downloads/local-executor`;

  const manifest = await fetch(`${base}/updates/beta/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('cache-control') || '', /no-store/i);
  assert.equal((await manifest.json()).version, '1.0.3');

  const installer = await fetch(`${base}/updates/beta/${file}`);
  assert.equal(installer.status, 200);
  assert.match(installer.headers.get('cache-control') || '', /immutable/i);
  assert.equal(await installer.text(), 'fake-installer');

  const unknownChannel = await fetch(`${base}/updates/nightly/manifest.json`);
  assert.equal(unknownChannel.status, 404);

  const arbitraryFile = await fetch(`${base}/updates/beta/not-allowed.txt`);
  assert.equal(arbitraryFile.status, 404);
});

test('public executor manifest and Windows download are driven by the stable update manifest', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yizhan-stable-download-'));
  const stable = path.join(root, 'local-executor-updates', 'stable');
  fs.mkdirSync(stable, { recursive: true });
  const file = 'yizhan-local-executor-v88-1.0.3-win-x64.exe';
  fs.writeFileSync(path.join(stable, file), 'stable-installer');
  fs.writeFileSync(path.join(stable, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    channel: 'stable',
    version: '1.0.3',
    platform: 'win32',
    arch: 'x64',
    file,
    sha256: 'b'.repeat(64),
    size: 16,
    publishedAt: '2026-09-06T00:00:00.000Z'
  }));

  const app = express();
  app.use('/downloads/local-executor', createLocalExecutorDownloadsRouter({ downloadsDir: root }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/downloads/local-executor`;

  const response = await fetch(`${base}/manifest.json`);
  assert.equal(response.status, 200);
  const publicManifest = await response.json();
  assert.equal(publicManifest.version, '1.0.3');
  assert.equal(publicManifest.latestVersion, '1.0.3');
  assert.equal(publicManifest.downloads.windows, `${base}/updates/stable/${file}`);
  assert.equal(publicManifest.windows.sha256, 'b'.repeat(64));
  assert.equal(publicManifest.windows.size, 16);
  assert.equal(publicManifest.windows.publishedAt, '2026-09-06T00:00:00.000Z');

  const installer = await fetch(publicManifest.downloads.windows);
  assert.equal(installer.status, 200);
  assert.equal(await installer.text(), 'stable-installer');
});
