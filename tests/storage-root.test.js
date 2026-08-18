// tests/storage-root.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FEATURE_SCRIPT, FEATURE_NOVEL_FETCH, FEATURE_NOVEL_ADAPT, FEATURE_PRODUCTION,
  sanitizeProjectName, getStorageRoot, featureDir, projectDir
} = require('../lib/storage-root');

test('sanitizeProjectName cleans illegal characters and falls back', () => {
  assert.equal(sanitizeProjectName('我的/项目: 一/二'), '我的_项目_ 一_二');
  assert.equal(sanitizeProjectName('   '), '未命名项目');
  assert.equal(sanitizeProjectName('a|b<c>d?e*f"g\\h'), 'a_b_c_d_e_f_g_h');
});

test('getStorageRoot reads config storageRoot and returns null when empty', () => {
  const fakeRead = () => ({ storageRoot: '   ' });
  assert.equal(getStorageRoot('u', fakeRead), null);
  assert.equal(getStorageRoot('u', () => ({})), null);
  assert.equal(getStorageRoot('u', () => ({ storageRoot: 'D:\\我的工程' })), 'D:\\我的工程');
});

test('featureDir creates the feature subfolder under root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-feature-'));
  try {
    const dir = featureDir(root, FEATURE_SCRIPT);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(path.basename(dir), '剧本生成');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('projectDir creates project folder with media subfolders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-project-'));
  try {
    const dir = projectDir(root, '测试项目/1');
    assert.equal(fs.existsSync(dir), true);
    for (const sub of ['图片', '视频', '剪映', '配音']) {
      assert.equal(fs.existsSync(path.join(dir, sub)), true, sub);
    }
    assert.equal(path.basename(dir), '测试项目_1');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
