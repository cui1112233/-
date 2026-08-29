const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'BatchFactoryPageV9.jsx');
const editorPath = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'batch-factory', 'BatchConstraintSettings.jsx');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function functionSource(page, functionName, nextFunctionName) {
  const start = page.indexOf(`function ${functionName}(`);
  const end = page.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.ok(start >= 0, `${functionName} source must exist`);
  assert.ok(end > start, `${nextFunctionName} must follow ${functionName}`);
  return page.slice(start, end);
}

test('production unified settings render constraints inline below a divider', () => {
  const page = source(pagePath);
  const unified = functionSource(page, 'UnifiedSettings', 'PublishSettings');
  assert.match(unified, /<Divider plain>约束设置<\/Divider>/);
  assert.match(unified, /<BatchConstraintEditor value=\{form\}/);
  assert.doesNotMatch(unified, /进入设置/);
});

test('production unified settings do not own publish version configuration', () => {
  const page = source(pagePath);
  const unified = functionSource(page, 'UnifiedSettings', 'PublishSettings');
  assert.doesNotMatch(unified, />版本配置</);
  assert.doesNotMatch(unified, /同步批量后台配置/);
  assert.doesNotMatch(unified, /同步最新配置/);
});

test('publish unified settings own version sync and only reuse/flip controls', () => {
  const page = source(pagePath);
  const publish = functionSource(page, 'PublishSettings', 'MergePanel');
  assert.match(publish, />版本配置</);
  assert.match(publish, /同步最新配置/);
  assert.match(publish, /不复用/);
  assert.match(publish, /复用/);
  assert.match(publish, /不翻转/);
  assert.match(publish, /翻转/);
  assert.doesNotMatch(publish, /解压视频数量/);
  assert.doesNotMatch(publish, /AI头部/);
  assert.doesNotMatch(publish, /jieyaVideoCount/);
  assert.doesNotMatch(publish, /aiHead/);
});

test('publish unified settings automatically exposes video management account states', () => {
  const page = source(pagePath);
  const publish = functionSource(page, 'PublishSettings', 'MergePanel');
  assert.match(publish, /视频管理系统/);
  assert.match(publish, /正在验证账号状态/);
  assert.match(publish, /账号在线/);
  assert.match(publish, /登录异常/);
  assert.match(publish, /账号登录状态已失效/);
  assert.match(publish, /重新登录/);
});

test('constraint editor exposes exactly the agreed five production constraint rows', () => {
  const editor = source(editorPath);
  assert.match(editor, /基础设定（人物 \/ 场景）/);
  assert.match(editor, /label: '画面前缀词'/);
  assert.match(editor, /label: '画质约束'/);
  assert.match(editor, /label: '画面限制'/);
  assert.match(editor, /label: '负面提示词'/);
  assert.doesNotMatch(editor, /字幕限制.*enabledKey/);
});

test('current novel opens a centered constraint modal with partial override reset', () => {
  const page = source(pagePath);
  const editor = source(editorPath);
  assert.match(page, /<Button size="small" onClick=\{\(\) => setConstraintOpen\(true\)\}>约束设置<\/Button>/);
  assert.match(page, /<BatchBookConstraintModal/);
  assert.match(editor, /title="约束设置"/);
  assert.match(editor, /恢复批次设置/);
  assert.match(editor, /updateBatchFactoryItemOverrides\(batch\.id, item\.id, patch\)/);
});
