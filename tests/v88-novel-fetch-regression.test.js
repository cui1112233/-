const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../lib/novel-fetch-workshop/mysql-store');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'dist', 'batch-rewrite', 'app.js'), 'utf8');
const v2Source = fs.readFileSync(path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js'), 'utf8');

test('processed original is locally limited while the full raw original remains available', () => {
  assert.equal(typeof store.limitProcessedOriginal, 'function');
  assert.equal(store.limitProcessedOriginal('甲'.repeat(27831), 4000).length, 4000);
  assert.equal(store.limitProcessedOriginal('甲'.repeat(6500), 8000).length, 6500);
});

test('V2 task bridge preserves the real date filter instead of forcing every task onto a fake date', () => {
  assert.ok(!v2Source.includes("const marker = '2099-12-31'"));
  assert.ok(!v2Source.includes('taskDateKey = () => marker'));
  assert.ok(v2Source.includes('patchTaskTableForV78(state.tasks || [])'));
});

test('legacy and V2 task presentation keep internal states Chinese and show processed/raw original counts', () => {
  assert.ok(appSource.includes('input_ready: "分类信息已就绪"'));
  assert.ok(appSource.includes('running: "正在执行中…"'));
  assert.ok(appSource.includes('Math.min(maxTxt, raw)'));
  assert.ok(v2Source.includes("input_ready: '分类信息已就绪'"));
  assert.ok(v2Source.includes("running: '正在执行中…'"));
  assert.ok(v2Source.includes('Math.min(maxTxt, raw)'));
  assert.ok(v2Source.includes('original_raw_chars'));
});
