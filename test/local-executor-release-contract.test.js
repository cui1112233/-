const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('desktop package is promoted to 1.0.0 with cross-platform builder scripts', () => {
  const pkg = JSON.parse(read('local-executor/package.json'));
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.devDependencies?.['electron-builder'], '26.15.3');
  assert.match(pkg.scripts?.['dist:win'] || '', /electron-builder/);
  assert.match(pkg.scripts?.['dist:mac'] || '', /electron-builder/);
  assert.equal(pkg.build?.appId, 'com.yizhanshengming.doubaoexecutor');
});

test('server download contract exposes 1.0.0 and removes legacy 0.1.14', () => {
  const source = read('routes/local-executor-downloads.js');
  assert.match(source, /RELEASE_VERSION\s*=\s*'1\.0\.0'/);
  assert.match(source, /yizhan-local-executor-1\.0\.0-mac-arm64\.dmg/);
  assert.match(source, /yizhan-local-executor-1\.0\.0-win-x64\.exe/);
  assert.doesNotMatch(source, /0\.1\.14/);
});

test('settings primary download buttons point only to 1.0.0', () => {
  const source = read('frontend/src/user/pages/SettingsPage.jsx');
  assert.match(source, /yizhan-local-executor-1\.0\.0-mac-arm64\.dmg/);
  assert.match(source, /yizhan-local-executor-1\.0\.0-win-x64\.exe/);
  assert.doesNotMatch(source, /0\.1\.14/);
});
