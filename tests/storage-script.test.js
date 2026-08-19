// tests/storage-script.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildScriptMd, writeScriptResultMd, FEATURE_SCRIPT } = require('../lib/storage-root');

test('buildScriptMd includes title, meta header and body', () => {
  const history = { id: 'h1', title: '测试剧本', format: '短剧', mode: '旁白', duration: '3分钟', createdAt: 0, output: '第1集 开场……' };
  const md = buildScriptMd(history);
  assert.match(md, /^# 测试剧本/m);
  assert.match(md, /格式：短剧/);
  assert.match(md, /第1集 开场/);
});

test('writeScriptResultMd writes into 剧本生成 folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-script-'));
  try {
    const history = { id: 'h1', title: 'T', format: '', mode: '', duration: '', createdAt: 0, output: '正文' };
    const file = writeScriptResultMd(root, history);
    assert.ok(file);
    assert.equal(path.basename(file), 'h1.md');
    assert.equal(path.dirname(file).endsWith(FEATURE_SCRIPT), true);
    assert.match(fs.readFileSync(file, 'utf8'), /正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeScriptResultMd returns null when root is null', () => {
  assert.equal(writeScriptResultMd(null, { id: 'h1', output: 'x' }), null);
});
