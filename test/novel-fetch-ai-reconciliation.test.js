const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('任务列表在读取时校正已保存 AI 文案的矛盾状态', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-rewrite.js'), 'utf8');
  assert.match(route, /rewrite\.reconcileAiTaskStatus/);
  assert.match(route, /recordLog:\s*true/);
});

test('任务详情将最近一次 AI 尝试失败与完成状态分开显示', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /ai_last_attempt_error/);
  assert.match(source, /AI最近失败/);
});

test('AI 文案计数只统计当前选中的 AI 槽位', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /generatedAi\.filter\(version => !selectedAi\.length \|\| selectedAi\.includes\(version\)\)/);
});

test('手动接口和后台执行器的 AI 异常分支都委托统一状态校正器', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-rewrite.js'), 'utf8');
  const runner = fs.readFileSync(path.join(__dirname, '..', 'lib', 'novel-fetch-workshop', 'runner.js'), 'utf8');
  assert.match(route, /catch \(error\) \{[\s\S]*?reconcileAiTaskStatus/);
  assert.match(runner, /reconcileAiTaskStatus/);
});
