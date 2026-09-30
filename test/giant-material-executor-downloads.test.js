const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createGiantMaterialExecutorDownloadsRouter } = require('../routes/giant-material-executor-downloads');

test('serves the macOS executor artifact and preserves the Windows artifact route', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giant-download-test-'));
  const macName = 'GiantMaterialExecutor-macos-universal.zip';
  const winName = 'GiantMaterialExecutor-windows-x64.zip';
  fs.writeFileSync(path.join(dir, macName), 'mac-package');
  fs.writeFileSync(path.join(dir, winName), 'windows-package');
  const app = express();
  app.use('/downloads/giant-material-executor', createGiantMaterialExecutorDownloadsRouter({ downloadsDir: dir }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const root = `http://127.0.0.1:${server.address().port}/downloads/giant-material-executor`;
    const mac = await fetch(`${root}/${macName}`);
    assert.equal(mac.status, 200);
    assert.equal(await mac.text(), 'mac-package');
    const win = await fetch(`${root}/${winName}`);
    assert.equal(win.status, 200);
    assert.equal(await win.text(), 'windows-package');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
