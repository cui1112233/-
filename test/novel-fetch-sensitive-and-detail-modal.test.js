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
  assert.match(app, /event\.target\.closest\("\.task-detail-section"\)/);
});
