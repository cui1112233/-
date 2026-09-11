const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPaths = [
  path.join(root, 'frontend', 'public', 'batch-rewrite', 'index.html'),
  path.join(root, 'frontend', 'dist', 'batch-rewrite', 'index.html'),
];
const appPaths = [
  path.join(root, 'frontend', 'public', 'batch-rewrite', 'app.js'),
  path.join(root, 'frontend', 'dist', 'batch-rewrite', 'app.js'),
];
const v78Source = fs.readFileSync(path.join(root, 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js'), 'utf8');

test('版本配置弹窗只保留配置档绑定，不重复显示本次处理版本', () => {
  for (const file of htmlPaths) {
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /<div class="field-title">本次处理版本<\/div>/, file);
    assert.doesNotMatch(html, /class="process-version"/, file);
    assert.doesNotMatch(html, /id="processAiMethod[1-5]"/, file);
  }
});

test('开始处理自动解析并立即创建当前批次，同时持续刷新实时日志', () => {
  assert.doesNotMatch(v78Source, /id="v78ParsePreviewBtn"/);
  assert.doesNotMatch(v78Source, />解析输入<\//);
  assert.match(v78Source, /await previewInput\(\)/);
  assert.match(v78Source, /\/process\/start/);
  assert.match(v78Source, /appendProcessLog/);
  assert.match(v78Source, /loadCurrentBatch\(\)/);
  assert.match(v78Source, /queue_state/);
  assert.doesNotMatch(v78Source, /请确认小说和本次版本后，再点“开始处理”/);
});

test('版本配置保存使用一个权威持久化请求，并恢复 V78 外层选择', () => {
  for (const file of appPaths) {
    const app = fs.readFileSync(file, 'utf8');
    assert.match(app, /v78TargetOriginal/);
    assert.match(app, /v78TargetAi/);
    assert.match(app, /batchRewriteApplyWorkFormState/);
    assert.match(app, /saveVersionConfigAuthority/);
    assert.doesNotMatch(app, /await saveWebSubmitConfig\(true\);\s*\n\s*if \(result\)/);
  }
});
