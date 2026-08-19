// tests/storage-config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeStorageRoot } = require('../lib/storage-root');

test('normalizeStorageRoot rejects non-absolute path', () => {
  const r = normalizeStorageRoot('相对路径');
  assert.notEqual(r.error, undefined);
  assert.match(r.error, /绝对路径/);
});

test('normalizeStorageRoot trims and accepts absolute path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-norm-'));
  try {
    const r = normalizeStorageRoot(`  ${root}  `);
    assert.equal(r.error, undefined);
    assert.equal(r.value, root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('normalizeStorageRoot allows empty (clear) and reports mkdir failure', () => {
  assert.equal(normalizeStorageRoot('').error, undefined);
  assert.equal(normalizeStorageRoot('').value, '');
  const bad = path.join('Z:', 'nope', 'no-such-dir-xyz');
  const r = normalizeStorageRoot(bad);
  assert.notEqual(r.error, undefined);
});
