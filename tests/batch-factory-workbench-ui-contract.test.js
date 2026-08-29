const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'frontend/src/user/pages/BatchFactoryPageV9.jsx');
const workspacePath = path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactoryWorkspace.jsx');
const unifiedPreviewPath = path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactoryUnifiedPreview.jsx');
const videoStatusPath = path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactoryVideoProductionStatus.jsx');

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

test('batch factory uses editable grid workspace instead of fixed columns', () => {
  const page = read(pagePath);
  assert.doesNotMatch(page, /gridTemplateColumns:\s*'minmax\(230px/);
  assert.match(page, /BatchFactoryWorkspace/);
  assert.equal(fs.existsSync(workspacePath), true);
});

test('batch factory has exactly one unified video player implementation', () => {
  assert.equal(fs.existsSync(unifiedPreviewPath), true);
  const files = [pagePath, videoStatusPath, unifiedPreviewPath].map(read);
  const videoTags = files.join('\n').match(/<video\b/g) || [];
  assert.equal(videoTags.length, 1);
});

test('workspace exposes explicit layout editing controls instead of accidental drag mode', () => {
  const workspace = read(workspacePath);
  assert.match(workspace, /编辑布局/);
  assert.match(workspace, /保存布局/);
  assert.match(workspace, /恢复默认布局/);
  assert.match(workspace, /取消/);
  assert.match(workspace, /layoutEditMode|editingLayout|isEditingLayout/);
});

test('status center renders filtered books beside status controls, not below them', () => {
  const statusPath = path.join(root, 'frontend/src/user/pages/batch-factory/BatchFactoryStatusCenter.jsx');
  const status = read(statusPath);
  assert.equal(fs.existsSync(statusPath), true);
  assert.match(status, /批次状态中心/);
  assert.match(status, /当前筛选/);
  assert.match(status, /selectedStatus|activeStatus|statusFilter/);
});
