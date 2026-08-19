const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildNovelPanelExportMd, writeNovelPanelExport } = require('../lib/storage-root');

test('buildNovelPanelExportMd lists final segments', () => {
  const project = { id: 'p1', name: '我的剧集/一', data: { final_segments: [{ finalText: '最终第一段' }, { finalText: '' , sourceText: '来源第二段' }] } };
  const md = buildNovelPanelExportMd(project);
  assert.match(md, /# 我的剧集\/一　输出结果/);
  assert.match(md, /最终第一段/);
  assert.match(md, /来源第二段/);
});

test('writeNovelPanelExport writes 输出结果.md into project folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-npe-'));
  try {
    const project = { id: 'p1', name: '我的剧集/一', data: { final_segments: [{ finalText: '正文' }] } };
    const file = writeNovelPanelExport(root, project);
    assert.ok(file);
    assert.equal(path.basename(path.dirname(file)), '我的剧集_一');
    assert.equal(path.basename(file), '输出结果.md');
    assert.match(fs.readFileSync(file, 'utf8'), /正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeNovelPanelExport returns null without root', () => {
  assert.equal(writeNovelPanelExport(null, { name: 'x', data: {} }), null);
});
