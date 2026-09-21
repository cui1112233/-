const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toV78Task } = require('../lib/novel-fetch-workshop/task-ops');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('敏感词重跑将本次开关和统一文本模型解析器传入敏感词处理', () => {
  const route = read('routes/batch-rewrite.js');
  assert.match(route, /function withSensitiveAiEnabled\(/);
  assert.match(route, /const config = withSensitiveAiEnabled\(object\(store\.getConfig\(\)\), req\.body\?\.sensitive_ai_enabled\);/);
  assert.match(route, /applySavedRulesToOriginal\(tasks, req\.username, id, config, store\)/);
  assert.match(route, /applySavedRulesToOriginal\(tasks, req\.username, req\.params\.id, config, store\)/);
});

test('所有任务详情浮层都有可见关闭按钮并支持点击遮罩关闭', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /function detailCloseControl\(/);
  assert.match(app, /renderSensitiveLog[\s\S]*detailCloseControl\(\)/);
  assert.match(app, /renderSiteSubmitLog[\s\S]*detailCloseControl\(\)/);
  assert.match(app, /event\.target\.closest\("#detail"\)/);
});

test('小说获取全部弹框支持遮罩退出，并在提交中锁定关闭', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /function setModalBusy\(/);
  assert.match(app, /dialog\.addEventListener\("pointerdown", event => \{/);
  assert.match(app, /event\.target === dialog && !isModalBusy\("webLoginDialog"\)/);
  assert.match(app, /setModalBusy\("webLoginDialog", true\)/);
  assert.match(app, /setModalBusy\("webLoginDialog", false\)/);
  assert.match(app, /loginButtons\.forEach\(button => \{ button\.disabled = true; \}\)/);
  assert.match(app, /loginButtons\.forEach\(button => \{ button\.disabled = false; \}\)/);
  assert.match(app, /event\.target === \$\("versionConfigCard"\) && !isModalBusy\("versionConfigCard"\)/);
  assert.match(app, /\$\("versionConfigCard"\)\.addEventListener\("pointerdown", event => \{/);
  assert.match(app, /setModalBusy\("versionConfigCard", true\)/);
  assert.match(app, /setModalBusy\("versionConfigCard", false\)/);
  assert.match(app, /if \(isModalBusy\("versionConfigCard"\)\) return;/);
});

test('任务列表详情遮罩按内容卡片判定，生成AI文案按钮直接执行', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /data-action="ai"[^>]*\$\{aiBusy \? "disabled" : ""\}[^>]*>\$\{aiBusy \? "生成中…" : "生成AI文案"\}<\/button>/);
  assert.match(app, /if \(event\.target\.closest\("#detail"\)\) return;/);
  const generateAi = app.match(/async function generateAi\(id\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction selectedTaskIds/);
  assert.ok(generateAi, 'generateAi implementation should remain present');
  assert.match(generateAi[0], /\/generate-ai/);
  assert.doesNotMatch(generateAi[0], /showTask\(id\)/);
});

test('生成AI文案点击后显示处理中并把失败原因反馈到任务区', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /aiProcessingIds: new Set\(\)/);
  assert.match(app, /data-action="ai"[^>]*\$\{aiBusy \? "disabled" : ""\}/);
  const generateAi = app.match(/async function generateAi\(id\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction selectedTaskIds/);
  assert.ok(generateAi, 'generateAi implementation should remain present');
  assert.match(generateAi[0], /state\.aiProcessingIds\.add\(id\)/);
  assert.match(generateAi[0], /正在生成AI文案/);
  assert.match(generateAi[0], /catch \(error\)/);
  assert.match(generateAi[0], /生成AI文案失败/);
  assert.match(generateAi[0], /state\.aiProcessingIds\.delete\(id\)/);
});

test('任务详情规范化保留阶段错误、当前版本和更新时间', () => {
  const normalized = toV78Task({
    bookId: 'book-1',
    originalErrorMessage: '上游返回 429：请求过于频繁',
    originalErrorCode: 'UPSTREAM_FETCH_ERROR',
    originalUpstreamCode: 429,
    classifyError: '分类模型超时',
    aiError: 'AI接口返回 403：额度不足',
    aiCurrentVersion: 'ai2',
    siteSubmitError: '121提交失败：会话已失效',
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:01:00.000Z'
  });
  assert.equal(normalized.original_error, '上游返回 429：请求过于频繁');
  assert.equal(normalized.original_error_code, 'UPSTREAM_FETCH_ERROR');
  assert.equal(normalized.original_upstream_code, 429);
  assert.equal(normalized.classify_error, '分类模型超时');
  assert.equal(normalized.ai_error, 'AI接口返回 403：额度不足');
  assert.equal(normalized.ai_current_version, 'ai2');
  assert.equal(normalized.site_submit_error, '121提交失败：会话已失效');
  assert.equal(normalized.created_at, '2026-09-21T00:00:00.000Z');
  assert.equal(normalized.updated_at, '2026-09-21T00:01:00.000Z');
});

test('任务详情展示阶段错误并在打开时持续刷新', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /metaItem\("AI失败原因", meta\.ai_error/);
  assert.match(app, /metaItem\("原文失败原因", meta\.original_error/);
  assert.match(app, /metaItem\("网站提交失败原因", meta\.site_submit_error/);
  assert.match(app, /metaItem\("最后更新时间", meta\.updated_at/);
  assert.match(app, /function startTaskDetailRefresh\(/);
  assert.match(app, /setInterval\(\(\) => { void refreshTaskDetail/);
  assert.match(app, /function stopTaskDetailRefresh\(/);
});

test('任务列表不向用户显示英文原始状态和提交版本', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /ai_processing:\s*"AI文案处理中"/);
  assert.match(app, /original_processing:\s*"原文处理中"/);
  assert.match(app, /function displayVersionLabel\(version\)/);
  assert.match(app, /done\.map\(displayVersionLabel\)/);
  assert.match(app, /version === "original" \? "原文"/);
});
