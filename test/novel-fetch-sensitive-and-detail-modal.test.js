const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(app, /data-action="ai"[^>]*>生成AI文案<\/button>/);
  assert.match(app, /if \(event\.target\.closest\("#detail"\)\) return;/);
  const generateAi = app.match(/async function generateAi\(id\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction selectedTaskIds/);
  assert.ok(generateAi, 'generateAi implementation should remain present');
  assert.match(generateAi[0], /\/generate-ai/);
  assert.doesNotMatch(generateAi[0], /showTask\(id\)/);
});
