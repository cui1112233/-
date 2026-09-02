const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Windows executor and web favicon use the Yizhan icon asset', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const web = fs.readFileSync(path.join(root, '..', 'frontend', 'index.html'), 'utf8');

  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.match(pkg.scripts['dist:win'], /prepare:icon/);
  assert.ok(pkg.build.files.includes('build/icon.png'));
  assert.match(web, /<link rel="icon" type="image\/png" href="data:image\/png;base64,/);
});

test('icon preparation emits valid PNG and ICO headers', () => {
  const root = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare-icon.js')], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);

  const png = fs.readFileSync(path.join(root, 'build', 'icon.png'));
  const ico = fs.readFileSync(path.join(root, 'build', 'icon.ico'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
});
