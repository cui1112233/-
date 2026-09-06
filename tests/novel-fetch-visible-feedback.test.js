const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'index.html');
const dockerfilePath = path.join(root, 'Dockerfile');
const feedbackPath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'interaction-feedback.js');
const taskVisibilityPath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'task-visibility-hotfix.js');
const appPath = path.join(root, 'frontend', 'public', 'batch-rewrite', 'app.js');
const pageHtml = fs.readFileSync(pagePath, 'utf8');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

test('小说获取公网构建会加载独立的可见交互反馈层', () => {
  const sourceLoadsDirectly = /interaction-feedback\.js/.test(pageHtml);
  const imageInjectsFeedback = /COPY frontend\/public\/batch-rewrite\/interaction-feedback\.js/.test(dockerfile)
    && /interaction-feedback\.js/.test(dockerfile);
  assert.ok(sourceLoadsDirectly || imageInjectsFeedback, '公网工作台构建必须加载 interaction-feedback.js');
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须随公网工作台发布');
});

test('开始处理和提交网络点击后立即给出进行中反馈', () => {
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须存在');
  const source = fs.readFileSync(feedbackPath, 'utf8');
  assert.match(source, /processBtn/);
  assert.match(source, /openWebSubmitBtn/);
  assert.match(source, /openWebSubmitFromTasks/);
  assert.match(source, /正在处理|正在提交/);
  assert.match(source, /aria-busy/);
});

test('局部状态错误、Promise 异常和页面异常必须升级成明显错误提示', () => {
  assert.ok(fs.existsSync(feedbackPath), 'interaction-feedback.js 必须存在');
  const source = fs.readFileSync(feedbackPath, 'utf8');
  assert.match(source, /MutationObserver/);
  assert.match(source, /processResult/);
  assert.match(source, /siteSubmitStatus/);
  assert.match(source, /batchStatus/);
  assert.match(source, /unhandledrejection/);
  assert.match(source, /addEventListener\(['"]error['"]/);
  assert.match(source, /role['"],\s*['"]alert['"]|role\s*=\s*['"]alert['"]/);
});

test('任务存在但日期筛选不匹配时不能静默显示空表', () => {
  assert.ok(fs.existsSync(taskVisibilityPath), 'task-visibility-hotfix.js 必须随公网工作台发布');
  assert.match(dockerfile, /COPY frontend\/public\/batch-rewrite\/task-visibility-hotfix\.js/);
  assert.match(dockerfile, /task-visibility-hotfix\.js/);
  const source = fs.readFileSync(taskVisibilityPath, 'utf8');
  assert.match(source, /taskDateKey/);
  assert.match(source, /state\.taskDate/);
  assert.match(source, /latest|最新/i);
  assert.match(source, /当前日期没有任务|自动切换到最新任务/);
  assert.match(source, /tasksBody/);
});

test('未选择任务时禁止发起 selected 网络提交', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  const start = source.indexOf('async function submitWebSubmit(mode)');
  assert.notEqual(start, -1, 'submitWebSubmit 必须存在');
  const snippet = source.slice(start, start + 2200);
  assert.match(snippet, /mode === ["']selected["']/);
  assert.match(snippet, /!selectedIds\.length/);
  assert.match(snippet, /showWebSubmitSelectionRequired/);
  const guardIndex = snippet.indexOf('showWebSubmitSelectionRequired');
  const requestIndex = snippet.indexOf('webSubmitRequestPayload');
  assert.ok(guardIndex >= 0 && requestIndex > guardIndex, '零选择保护必须发生在构造/发送提交请求之前');
});
