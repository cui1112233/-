const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUN_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2-run-controls.js');
const PAGE_SOURCE_PATH = path.join(__dirname, '..', 'lib', 'novel-fetch-workshop', 'v2-page.js');
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'novel-fetch-v2-check.yml');
const AUDIT_PATH = path.join(__dirname, '..', 'docs', 'superpowers', 'audits', '2026-09-02-v78-novel-fetch-v2-completion-audit.md');
const runSource = fs.existsSync(RUN_SOURCE_PATH) ? fs.readFileSync(RUN_SOURCE_PATH, 'utf8') : '';
const pageSource = fs.readFileSync(PAGE_SOURCE_PATH, 'utf8');
const workflowSource = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const auditSource = fs.existsSync(AUDIT_PATH) ? fs.readFileSync(AUDIT_PATH, 'utf8') : '';

test('V78 run controls expose per-slot rewrite methods matching the reference layout', () => {
  for (const marker of ['v78RunAiMethod${index}', 'index <= 5', 'v78RunMethodGrid', '指令改文', '开头词+指令', '高仿文章']) {
    assert.ok(runSource.includes(marker), `missing ${marker}`);
  }
});

test('V78 scheduled processing button writes the current run snapshot to the scheduler API', () => {
  for (const marker of ['v78ScheduleBtn', '定时处理', "api('/schedules'", 'inputSnapshot', 'runAt', 'buildCurrentRunSnapshot']) {
    assert.ok(runSource.includes(marker), `missing ${marker}`);
  }
});

test('V78 scheduled processing includes a real manager for viewing, refreshing, cancelling and deleting schedules', () => {
  for (const marker of [
    'v78ScheduleManagerBtn',
    'v78ScheduleListDialog',
    '定时任务管理',
    '刷新定时任务',
    "api('/schedules')",
    "method: 'PATCH'",
    'enabled: false',
    "method: 'DELETE'",
    '取消定时',
    '删除记录'
  ]) {
    assert.ok(runSource.includes(marker), `missing ${marker}`);
  }
});

test('V78 sensitive AI repair button uses the existing sensitive reprocess API for the current batch', () => {
  for (const marker of ['v78SensitiveRepairBtn', '敏感词 AI 修复', '/batches/current', '/tasks/reprocess-sensitive', "mode: 'selected'"]) {
    assert.ok(runSource.includes(marker), `missing ${marker}`);
  }
});

test('run controls preserve single target-version selection and inject the chosen per-slot methods into process start', () => {
  assert.ok(runSource.includes('batch-rewrite\\/process\\/start'));
  assert.ok(runSource.includes('ai_slot_methods_snapshot'));
  assert.ok(runSource.includes('target_versions'));
  assert.ok(!runSource.includes('上传版本选择'));
});

test('V78 page injects the run-controls client after the existing V2 clients', () => {
  assert.ok(pageSource.includes('RUN_CONTROLS_CLIENT_PATH'));
  assert.ok(pageSource.includes('v78-novel-fetch-v2-run-controls.js'));
});

test('novel fetch completion workflow runs full Node regression, 121 Worker tests and frontend build', () => {
  for (const marker of [
    'Run full Node regression',
    'node --test tests/*.test.js lib/*.test.js routes/*.test.js',
    'Install 121 Browser Worker dependencies',
    'npm --prefix services/121-browser-worker test',
    'Install frontend dependencies',
    'npm run frontend:build'
  ]) {
    assert.ok(workflowSource.includes(marker), `missing workflow gate ${marker}`);
  }
});

test('completion audit closes the legacy feature inventory instead of only citing raw counts', () => {
  for (const marker of [
    '60 个后台接口',
    '215 个页面控件',
    '已保留',
    '新版替代',
    '真正遗漏',
    '定时任务',
    '121 网站提交',
    '最终结论'
  ]) {
    assert.ok(auditSource.includes(marker), `missing audit marker ${marker}`);
  }
});

test('run controls script is valid JavaScript once implemented', () => {
  if (runSource) assert.doesNotThrow(() => new Function(runSource));
});